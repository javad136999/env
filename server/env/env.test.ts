import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertUser } from "../db";
import { parseReport, reportWarnings, reportsCsv, type Report } from "./reports";
import { registerEnvRoutes } from "./routes";

const realFetch = globalThis.fetch;
const ID_A = "00000000-0000-4000-8000-000000000001";
const ID_B = "00000000-0000-4000-8000-000000000002";
const time = "2026-01-01T00:00:00.000Z";
const report = (id: string, companyId: string, year = 1403) => ({
  id, company_id: companyId, year, period: 1, category: "water",
  values: { water_consumption: 100, old_column: "preserve-me" }, status: "submitted",
  updated_at: time, revision: 1, source_meta: { original: "legacy" }, updated_by: null,
});
const payload = { companyId: "company-a", year: 1403, period: 1, category: "water", values: { water_consumption: 120 }, status: "submitted" };

type DbRow = Record<string, any>;
let server: Server;
let base: string;
let db: Record<string, DbRow[]>;
let calls: { url: URL; method: string; body?: DbRow }[];
let fail = false;
let race = false;

beforeEach(async () => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "unit-only-key");
  vi.stubEnv("SUPABASE_ADMIN_EMAIL", "");
  db = {
    env_companies: [{ id: "company-a", name: "Company A" }, { id: "company-b", name: "Company B" }],
    env_accounts: [
      { open_id: "user-a", name: "User A", email: null, role: "company", company_id: "company-a" },
      { open_id: "admin-a", name: "Admin A", email: null, role: "admin", company_id: "company-a" },
      { open_id: "pending-a", name: "Pending A", email: null, role: "pending", company_id: null },
      { open_id: "unassigned-admin", name: "No Company", email: null, role: "admin", company_id: null },
    ],
    env_reports: [report(ID_A, "company-a"), report(ID_B, "company-b")],
  };
  calls = []; fail = false; race = false;
  vi.stubGlobal("fetch", vi.fn(async (resource: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof resource === "string" || resource instanceof URL ? String(resource) : resource.url);
    if (url.origin !== "https://vcayskykkanmfanvjqlh.supabase.co") {
      if (url.hostname !== "127.0.0.1") throw new Error("Unexpected external connection in test");
      return realFetch(resource, init);
    }
    if (url.pathname === "/auth/v1/user") {
      const token = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer /, "") ?? "";
      const openId = token.startsWith("test-token-") ? token.slice("test-token-".length) : "";
      if (!openId) return Response.json({ message: "invalid token" }, { status: 401 });
      return Response.json({ id: openId, email: `${openId}@example.com`, user_metadata: { name: "Session Name" } });
    }
    const table = url.pathname.split("/").pop()!;
    if (!(table in db)) throw new Error("Unexpected table");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (fail) return new Response('{"message":"secret payload unit-only-key"}', { status: 500 });
    const matches = (row: DbRow) => [...url.searchParams].every(([key, value]) => {
      if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
      if (value.startsWith("neq.")) return String(row[key]) !== value.slice(4);
      if (value.startsWith("lt.")) return Number(row[key]) < Number(value.slice(3));
      return true;
    });
    if (method === "GET") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 100);
      return Response.json(db[table].filter(matches).slice(offset, offset + limit));
    }
    if (table === "env_accounts" && method === "POST") {
      if (!db[table].some(row => row.open_id === body.open_id)) db[table].push(body);
      return new Response(null, { status: 201 });
    }
    if (table === "env_accounts" && method === "PATCH") {
      const found = db[table].find(matches);
      if (!found) return Response.json([]);
      Object.assign(found, body);
      return Response.json([found]);
    }
    if (table === "env_companies" && method === "POST") {
      let company = db[table].find(row => row.id === body.id);
      if (company) Object.assign(company, body);
      else { company = body; db[table].push(company!); }
      return Response.json([company]);
    }
    if (table === "env_reports" && method === "PATCH") {
      const found = db[table].find(matches);
      if (!found || race) return Response.json([]);
      Object.assign(found, body);
      return Response.json([found]);
    }
    if (table === "env_reports" && method === "POST") {
      if (db[table].some(row => row.company_id === body.company_id && row.year === body.year && row.period === body.period && row.category === body.category)) return new Response(null, { status: 409 });
      const created = { id: "00000000-0000-4000-8000-000000000003", ...body };
      db[table].push(created);
      return Response.json([created], { status: 201 });
    }
    throw new Error("Unexpected request");
  }));
  const app = express();
  app.use(express.json());
  registerEnvRoutes(app);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function request(path: string, openId?: string, body?: unknown) {
  const token = openId ? `test-token-${openId}` : undefined;
  return fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("env permissions and persistence (mock database only)", () => {
  it("returns logged-out state and never invents an administrator when owner is unset", async () => {
    const noLogin = await (await request("/api/env/context")).json();
    expect(noLogin).toMatchObject({ authenticated: false, configured: true });
    const pending = await (await request("/api/env/context", "pending-a")).json();
    expect(pending).toEqual({ authenticated: true, configured: true, user: { name: "Pending A", role: "pending" } });
    expect(calls.some(call => call.url.pathname.endsWith("env_reports"))).toBe(false);
    expect((await request("/api/env/export", "pending-a")).status).toBe(403);
    expect((await request("/api/env/reports", "pending-a", payload)).status).toBe(403);
    // An explicitly assigned administrator is organization-wide, even without a company.
    expect((await (await request("/api/env/context", "unassigned-admin")).json()).user.role).toBe("admin");
    const preview = await (await request("/api/env/context", "preview-new")).json();
    expect(preview.user.role).toBe("pending");
    expect(db.env_accounts.find(x => x.open_id === "preview-new")).toMatchObject({ role: "pending", company_id: null });
  });
  it("limits company reads, writes, and exports to the verified account company", async () => {
    const context = await (await request("/api/env/context", "user-a")).json();
    expect(context.user).toEqual({ name: "User A", role: "company", companyId: "company-a" });
    expect(context.companies.map((x: DbRow) => x.id)).toEqual(["company-a"]);
    expect(context.reports.map((x: DbRow) => x.id)).toEqual([ID_A]);
    const read = calls.find(call => call.url.pathname.endsWith("env_reports"));
    expect(read?.url.searchParams.get("company_id")).toBe("eq.company-a");
    expect((await request("/api/env/export?companyId=company-b", "user-a")).status).toBe(403);
    expect((await request("/api/env/reports", "user-a", { ...payload, companyId: "company-b" })).status).toBe(403);
    expect((await request("/api/env/reports", "user-a", { ...payload, id: ID_B, revision: 1 })).status).toBe(404);
    const exported = await request("/api/env/export", "user-a");
    const bytes = new Uint8Array(await exported.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain(ID_A);
    expect(text).not.toContain(ID_B);
  });
  it("permits assigned admins and explicitly configured owner, not a missing owner", async () => {
    const admin = await (await request("/api/env/context", "admin-a")).json();
    expect(admin.user.role).toBe("admin");
    expect(admin.reports).toHaveLength(2);
    vi.stubEnv("SUPABASE_ADMIN_EMAIL", "owner@example.com");
    const owner = await (await request("/api/env/context", "owner")).json();
    expect(owner.user.role).toBe("admin");
    expect(owner.reports).toHaveLength(2);
  });
  it("allows only an admin to manage companies and existing account assignments", async () => {
    expect((await request("/api/env/admin/accounts", "user-a")).status).toBe(403);
    expect((await request("/api/env/admin/accounts", "user-a", { openId: "pending-a", role: "admin", companyId: "company-a" })).status).toBe(403);
    expect((await request("/api/env/admin/companies", "pending-a", { id: "company-c", name: "Company C" })).status).toBe(403);
    const list = await request("/api/env/admin/accounts", "admin-a");
    expect(list.status).toBe(200);
    expect((await list.json()).accounts).toContainEqual(expect.objectContaining({ openId: "pending-a", role: "pending" }));
    expect((await request("/api/env/admin/companies", "admin-a", { id: "bad/id", name: "Bad" })).status).toBe(400);
    expect((await request("/api/env/admin/companies", "admin-a", { id: "company-c", name: "Company C" })).status).toBe(200);
    expect((await request("/api/env/admin/companies", "admin-a", { id: "company-c", name: "Renamed" })).status).toBe(200);
    expect(db.env_companies.find(x => x.id === "company-c")?.name).toBe("Renamed");
    expect((await request("/api/env/admin/accounts", "admin-a", { openId: "missing", role: "company", companyId: "company-c" })).status).toBe(404);
    expect((await request("/api/env/admin/accounts", "admin-a", { openId: "pending-a", role: "company", companyId: "unknown" })).status).toBe(400);
    const assign = await request("/api/env/admin/accounts", "admin-a", { openId: "pending-a", role: "company", companyId: "company-c" });
    expect(assign.status).toBe(200);
    expect(db.env_accounts.find(x => x.open_id === "pending-a")).toMatchObject({ role: "company", company_id: "company-c" });
    const patch = calls.find(call => call.method === "PATCH" && call.url.pathname.endsWith("env_accounts"));
    expect(patch?.url.searchParams.get("role")).toBe("neq.admin");
    expect((await request("/api/env/admin/accounts", "admin-a", { openId: "admin-a", role: "company", companyId: "company-a" })).status).toBe(409);
    expect(db.env_accounts.find(x => x.open_id === "admin-a")?.role).toBe("admin");
  });
  it("upserts only pending identities without overwriting existing privileges", async () => {
    await upsertUser({ openId: "new-user", name: "New", email: "new-user@example.com" });
    expect(db.env_accounts.find(x => x.open_id === "new-user")).toMatchObject({ role: "pending", company_id: null });
    await upsertUser({ openId: "admin-a", name: "New Name", email: "admin-a@example.com" });
    expect(db.env_accounts.find(x => x.open_id === "admin-a")).toMatchObject({ role: "admin", company_id: "company-a" });
    expect(calls.filter(call => call.method === "POST").every(call => call.body?.role === "pending")).toBe(true);
  });
  it("creates a new report without a client-chosen id, and records the actor", async () => {
    const rows = JSON.stringify([{ source: "well", amount: 3, unit: "m3" }]);
    const response = await request("/api/env/reports", "user-a", { ...payload, year: 1404, values: { water_sources: rows } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.report).toMatchObject({ companyId: "company-a", revision: 1, year: 1404, values: { water_sources: rows } });
    expect(db.env_reports[2].updated_by).toBe("user-a");
  });
  it("edits atomically with revision, preserves source metadata, and attributes the edit", async () => {
    const edited = await request("/api/env/reports", "user-a", { ...payload, id: ID_A, revision: 1, values: { water_consumption: 120, old_column: "preserve-me", water_sources: JSON.stringify([{ source: "well", amount: 3, unit: "m3" }]) } });
    expect(edited.status).toBe(200);
    expect((await edited.json()).report).toMatchObject({ revision: 2, values: { old_column: "preserve-me", water_consumption: 120, water_sources: JSON.stringify([{ source: "well", amount: 3, unit: "m3" }]) } });
    const patch = calls.find(call => call.method === "PATCH")!;
    expect(patch.url.searchParams.get("revision")).toBe("eq.1");
    expect(patch.url.searchParams.get("company_id")).toBe("eq.company-a");
    expect(patch.body).toMatchObject({ updated_by: "user-a", revision: 2 });
    expect(patch.body).not.toHaveProperty("source_meta");
    expect(db.env_reports[0].source_meta).toEqual({ original: "legacy" });
    expect((await request("/api/env/reports", "user-a", { ...payload, id: ID_A, revision: 2, values: { water_consumption: 120, old_column: "tampered" } })).status).toBe(400);
    expect((await request("/api/env/reports", "user-a", { ...payload, id: ID_A, revision: 1 })).status).toBe(409);
    race = true;
    expect((await request("/api/env/reports", "user-a", { ...payload, id: ID_A, revision: 2 })).status).toBe(409);
  });
  it("returns conflict on duplicate period and never exposes upstream failures", async () => {
    expect((await request("/api/env/reports", "user-a", payload)).status).toBe(409);
    fail = true;
    const response = await request("/api/env/context", "user-a");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/unit-only-key|secret payload/);
  });
});

describe("report validation, comparisons, and CSV", () => {
  it("rejects invalid fields, statuses, values, periods, and edits without revision", () => {
    for (const bad of [
      { ...payload, values: { unknown: 1 } },
      { ...payload, values: { water_consumption: -1 } },
      { ...payload, values: { water_consumption: "12" } },
      { ...payload, status: "admin" }, { ...payload, period: 3 },
      { ...payload, id: ID_A }, { ...payload, revision: 1 },
      { ...payload, category: "indicators", period: 2, values: { E1: 1 } },
      { ...payload, companyRole: "admin" },
    ]) expect(() => parseReport(bad)).toThrow();
    expect(parseReport({ ...payload, category: "indicators", period: 0, values: { E1: 1 } }).period).toBe(0);
  });
  it("validates each permitted JSON row section and rejects unsafe or oversized rows", () => {
    const sections = [
      ["water", "water_sources", { source: "well", amount: 3, unit: "m3" }],
      ["water", "water_effluents", { volume: 2, pond: "pond", cod: 3 }],
      ["waste", "waste_streams", { waste_name: "material", generated: 4, product_unit: "t" }],
      ["air", "air_flaring", { month: "one", flare_gas: 3, co2: 8 }],
      ["air", "air_combustion", { source_type: "heater", source_count: 3, fuel_amount: 8 }],
      ["air", "air_flare_composition", { name: "component", basis: "molar", percentage: 1 }],
      ["air", "air_feed_products", { name: "feed", amount: 1, unit: "t" }],
    ] as const;
    for (const [category, key, row] of sections) {
      expect(parseReport({ ...payload, category, values: { [key]: JSON.stringify([row]) } }).values[key]).toBe(JSON.stringify([row]));
      expect(() => parseReport({ ...payload, category, values: { [key]: JSON.stringify([{ ...row, malicious: 1 }]) } })).toThrow();
    }
    for (const bad of ["not json", "{}", "[]", '[{"amount":-1}]', '[{"amount":"5"}]', '[{"__proto__":{"role":"admin"}}]', JSON.stringify(Array.from({ length: 101 }, () => ({ amount: 1 }))), JSON.stringify([{ source: "x".repeat(31000) }])]) {
      expect(() => parseReport({ ...payload, values: { water_sources: bad } })).toThrow();
    }
    expect(parseReport({ ...payload, category: "indicators", period: 0, values: { E20_monitored: 1, E20_eligible: 2 } }).values).toEqual({ E20_monitored: 1, E20_eligible: 2 });
  });
  it("compares the same field, category, period and company; handles zero/missing", () => {
    const baseReport: Report = { id: ID_A, revision: 1, updatedAt: time, companyId: "company-a", year: 1402, period: 1, category: "water", values: { water_consumption: 100, water_recycled: 0 }, status: "submitted" };
    const current = parseReport({ ...payload, values: { water_consumption: 120, water_recycled: 10, wastewater_generated: 5 } });
    const warnings = reportWarnings(current, [baseReport, { ...baseReport, id: ID_B, companyId: "company-b", values: { water_consumption: 999999 } }, { ...baseReport, id: "00000000-0000-4000-8000-000000000004", period: 2, values: { water_consumption: 999999 } }]);
    expect(warnings[0].change).toBe(20);
    expect(warnings[0].message).toContain("آستانه");
    expect(warnings[1].change).toBeNull();
    expect(warnings[1].message).toContain("صفر");
    expect(warnings[2].message).toContain("موجود نیست");
  });
  it("prefixes formula-like CSV cells and emits BOM", () => {
    const csv = reportsCsv([{ id: ID_A, revision: 1, updatedAt: time, companyId: "  =CMD(1)", year: 1403, period: 1, category: "water", values: { water_consumption: 1 }, status: "draft" }]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(`"'  =CMD(1)"`);
  });
});
