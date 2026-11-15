import type { Express, Request, Response } from "express";
import * as db from "../db";
import { sdk, type SessionPayload } from "../_core/sdk";
import { EnvError, accessDenied, notConfigured, reportConflict } from "./errors";
import { assertLegacyValuesUnchanged, parseReport, preserveLegacyValues, reportsCsv, reportWarnings } from "./reports";
import { findAccount, findCompany, findReport, hasSupabaseConfiguration, insertReport, listAccounts, listCompanies, listReports, saveCompany, setAccountMembership, updateReport, type AccountRow } from "./supabase";

function sendError(res: Response, error: unknown, extra: Record<string, unknown> = {}) {
  const safe = error instanceof EnvError ? error : new EnvError("INTERNAL_ERROR", "خطای داخلی در پردازش درخواست.", 500);
  res.status(safe.status).json({ ...extra, error: { code: safe.code, message: safe.message } });
}
function noSession() { return new EnvError("UNAUTHENTICATED", "برای ادامه با Manus وارد شوید.", 401); }
function noStore(res: Response) {
  res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization" });
}
function publicUser(user: db.AuthUser) {
  const role = user.role === "admin" ? "admin" as const : user.role === "user" ? "company" as const : "pending" as const;
  return { name: user.name, role, ...(role !== "pending" && user.companyId ? { companyId: user.companyId } : {}) };
}
async function identity(req: Request): Promise<SessionPayload> {
  const session = await sdk.verifyRequestSession(req);
  if (!session || session.openId.startsWith("cron_")) throw noSession();
  return session;
}
async function account(session: SessionPayload): Promise<db.AuthUser> {
  const existing = await db.getUserByOpenId(session.openId, session.name);
  if (existing) return existing;
  // Preview may provide a real, project-bound verified JWT before the OAuth callback.
  // Create only an unassigned pending account, never membership or privilege.
  await db.upsertUser({ openId: session.openId, name: session.name || null });
  const registered = await db.getUserByOpenId(session.openId, session.name);
  if (!registered) throw new EnvError("DATABASE_ERROR", "ثبت حساب در پایگاه داده ناموفق بود.", 503);
  return registered;
}
async function authorized(session: SessionPayload): Promise<db.AuthUser> {
  const user = await account(session);
  if (user.role === "pending") throw accessDenied();
  return user;
}
function isAllowed(user: db.AuthUser, companyId: string): boolean {
  return user.role === "admin" || (user.role === "user" && !!user.companyId && user.companyId === companyId);
}
async function requireAdmin(req: Request): Promise<db.AuthUser> {
  const user = await authorized(await identity(req));
  if (user.role !== "admin") throw accessDenied();
  return user;
}
function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}
function validObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function adminAccount(row: AccountRow) {
  if (!validText(row.open_id, 200) || (row.role !== "pending" && row.role !== "company" && row.role !== "admin") ||
    (row.name !== null && typeof row.name !== "string") || (row.email !== null && typeof row.email !== "string") ||
    (row.company_id !== null && !validText(row.company_id, 200))) {
    throw new EnvError("DATABASE_RESPONSE_INVALID", "اطلاعات حساب معتبر نیست.", 503);
  }
  return { openId: row.open_id, name: row.name, email: row.email, role: row.role, companyId: row.company_id };
}

export function registerEnvRoutes(app: Express) {
  app.get("/api/env/admin/accounts", async (req, res) => {
    noStore(res);
    try {
      await requireAdmin(req);
      res.json({ accounts: (await listAccounts()).map(adminAccount) });
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/env/admin/companies", async (req, res) => {
    noStore(res);
    try {
      if (!req.is("application/json")) throw new EnvError("CONTENT_TYPE_INVALID", "درخواست باید application/json باشد.", 415);
      await requireAdmin(req);
      const body: unknown = req.body;
      if (!validObject(body) || Object.keys(body).some(key => key !== "id" && key !== "name") ||
        typeof body.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(body.id) || !validText(body.name, 200)) {
        throw new EnvError("COMPANY_INVALID", "مشخصات شرکت معتبر نیست.", 400);
      }
      res.json({ company: await saveCompany(body.id, body.name) });
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/env/admin/accounts", async (req, res) => {
    noStore(res);
    try {
      if (!req.is("application/json")) throw new EnvError("CONTENT_TYPE_INVALID", "درخواست باید application/json باشد.", 415);
      await requireAdmin(req);
      const body: unknown = req.body;
      if (!validObject(body) || Object.keys(body).some(key => !["openId", "role", "companyId"].includes(key)) ||
        !validText(body.openId, 200) || body.openId.startsWith("cron_") ||
        (body.role !== "admin" && body.role !== "company" && body.role !== "pending") ||
        (body.role === "pending" ? body.companyId !== null && body.companyId !== undefined : !validText(body.companyId, 200))) {
        throw new EnvError("ACCOUNT_INVALID", "مشخصات حساب معتبر نیست.", 400);
      }
      const existing = await findAccount(body.openId);
      if (!existing || existing.open_id !== body.openId) throw new EnvError("ACCOUNT_NOT_FOUND", "حساب مورد نظر وجود ندارد.", 404);
      if (existing.role === "admin" && body.role !== "admin") {
        // No transactional last-admin guard is available through plain PostgREST.
        // Never demote an administrator rather than risk deleting the last one.
        throw new EnvError("ADMIN_DEMOTION_BLOCKED", "کاهش نقش مدیر از این مسیر مجاز نیست.", 409);
      }
      const companyId = body.role === "pending" ? null : body.companyId as string;
      if (companyId !== null && !await findCompany(companyId)) throw new EnvError("COMPANY_UNKNOWN", "شرکت انتخاب‌شده وجود ندارد.", 400);
      const updated = await setAccountMembership(body.openId, body.role, companyId);
      res.json({ account: adminAccount(updated) });
    } catch (error) { sendError(res, error); }
  });

  app.get("/api/env/context", async (req, res) => {
    noStore(res);
    let session: SessionPayload | null = null;
    try {
      session = await sdk.verifyRequestSession(req);
      if (!session || session.openId.startsWith("cron_")) {
        res.json({ authenticated: false, configured: hasSupabaseConfiguration() });
        return;
      }
      if (!hasSupabaseConfiguration()) throw notConfigured();
      const user = await account(session);
      if (user.role === "pending") {
        // Do not query or expose any company or report data for pending identities.
        res.json({ authenticated: true, configured: true, user: publicUser(user) });
        return;
      }
      const companyId = user.role === "admin" ? undefined : user.companyId;
      if (user.role !== "admin" && !companyId) throw accessDenied();
      const [companies, reports] = await Promise.all([listCompanies(companyId), listReports({ companyId })]);
      res.json({ authenticated: true, configured: true, user: publicUser(user), companies, reports });
    } catch (error) {
      sendError(res, error, { authenticated: !!session && !session.openId.startsWith("cron_"), configured: hasSupabaseConfiguration() });
    }
  });

  app.post("/api/env/reports", async (req, res) => {
    noStore(res);
    try {
      if (!req.is("application/json")) throw new EnvError("CONTENT_TYPE_INVALID", "درخواست باید application/json باشد.", 415);
      const session = await identity(req);
      const user = await authorized(session);
      let input = parseReport(req.body, true);
      if (!isAllowed(user, input.companyId)) throw accessDenied();
      if (input.id !== undefined) {
        const original = await findReport(input.id, user.role === "admin" ? undefined : user.companyId);
        if (!original) throw new EnvError("REPORT_NOT_FOUND", "گزارش در دسترس نیست.", 404);
        if (original.companyId !== input.companyId) throw accessDenied();
        if (original.year !== input.year || original.period !== input.period || original.category !== input.category) {
          throw new EnvError("REPORT_IDENTITY_IMMUTABLE", "سال، دوره و حوزه گزارش موجود هنگام ویرایش قابل تغییر نیستند.", 409);
        }
        if (original.revision !== input.revision) throw reportConflict();
        assertLegacyValuesUnchanged(input, original);
        input = preserveLegacyValues(input, original);
      } else {
        assertLegacyValuesUnchanged(input);
        if (user.role === "admin" && !await findCompany(input.companyId)) {
          throw new EnvError("COMPANY_UNKNOWN", "شرکت انتخاب‌شده وجود ندارد.", 400);
        }
      }
      const history = await listReports({ companyId: input.companyId, category: input.category, period: input.period, beforeYear: input.year });
      const warnings = reportWarnings(input, history);
      const report = input.id !== undefined && input.revision !== undefined
        ? await updateReport({ ...input, id: input.id, revision: input.revision }, user.openId)
        : await insertReport(input, user.openId);
      res.json({ report, warnings });
    } catch (error) { sendError(res, error); }
  });

  app.get("/api/env/export", async (req, res) => {
    noStore(res);
    try {
      const session = await identity(req);
      const user = await authorized(session);
      const requested = req.query.companyId;
      if (requested !== undefined && (typeof requested !== "string" || !requested || requested.length > 200 || requested !== requested.trim() || /[\u0000-\u001f\u007f]/.test(requested))) {
        throw new EnvError("FILTER_INVALID", "فیلتر companyId معتبر نیست.", 400);
      }
      if (typeof requested === "string" && !isAllowed(user, requested)) throw accessDenied();
      const companyId = typeof requested === "string" ? requested : user.role === "admin" ? undefined : user.companyId;
      if (user.role !== "admin" && !companyId) throw accessDenied();
      const reports = await listReports({ companyId });
      res.status(200).set("Content-Disposition", 'attachment; filename="env-reports.csv"').type("text/csv; charset=utf-8").send(reportsCsv(reports));
    } catch (error) { sendError(res, error); }
  });
}
