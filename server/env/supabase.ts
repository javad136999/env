import { EnvError, notConfigured, reportConflict } from "./errors";
import type { Report, ReportInput } from "./reports";
import { reportFromRow } from "./reports";

// Fixed project; the service credential is read only on the server and is never logged.
const REST_URL = "https://vcayskykkanmfanvjqlh.supabase.co/rest/v1";
const PAGE_SIZE = 500;
const REPORT_COLUMNS = "id,company_id,year,period,category,values,status,updated_at,revision";

export type Company = { id: string; name: string };
export type AccountRow = {
  open_id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  company_id: string | null;
};

type Table = "env_accounts" | "env_companies" | "env_reports";
type Method = "GET" | "POST" | "PATCH";
export function hasSupabaseConfiguration(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

async function request<T>(table: Table, query: URLSearchParams, method: Method = "GET", body?: unknown, prefer?: string): Promise<T> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key?.trim()) throw notConfigured();
  let response: Response;
  try {
    response = await fetch(`${REST_URL}/${table}?${query}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(prefer ? { Prefer: prefer } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new EnvError("DATABASE_UNAVAILABLE", "ارتباط با پایگاه داده در دسترس نیست.", 503);
  }
  if (!response.ok) {
    // Do not forward upstream response bodies, URLs, details, or credentials.
    if (response.status === 409) throw reportConflict();
    throw new EnvError("DATABASE_ERROR", "درخواست پایگاه داده ناموفق بود.", 503);
  }
  if (response.status === 204 || prefer?.includes("return=minimal")) return undefined as T;
  try { return await response.json() as T; }
  catch { throw new EnvError("DATABASE_RESPONSE_INVALID", "پاسخ پایگاه داده معتبر نیست.", 503); }
}

function query(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}
function rows<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new EnvError("DATABASE_RESPONSE_INVALID", "پاسخ پایگاه داده معتبر نیست.", 503);
  return value as T[];
}

async function allRows<T>(table: Table, params: Record<string, string>): Promise<T[]> {
  const output: T[] = [];
  let offset = 0;
  // Continue to an empty page, even if a server-side maximum is below PAGE_SIZE.
  for (;;) {
    const page = rows<T>(await request<unknown>(table, query({ ...params, limit: String(PAGE_SIZE), offset: String(offset) })));
    if (page.length === 0) return output;
    output.push(...page);
    offset += page.length;
  }
}

export async function findAccount(openId: string): Promise<AccountRow | undefined> {
  const result = rows<AccountRow>(await request<unknown>("env_accounts", query({ select: "open_id,name,email,role,company_id", open_id: `eq.${openId}`, limit: "1" })));
  return result[0];
}

export async function listAccounts(): Promise<AccountRow[]> {
  return allRows<AccountRow>("env_accounts", { select: "open_id,name,email,role,company_id", order: "open_id.asc" });
}

export async function setAccountMembership(openId: string, role: "admin" | "company" | "pending", companyId: string | null): Promise<AccountRow> {
  const params: Record<string, string> = { select: "open_id,name,email,role,company_id", open_id: `eq.${openId}` };
  // Do not demote any administrator via REST. The condition closes the race
  // where this account is promoted after the caller reads it.
  if (role !== "admin") params.role = "neq.admin";
  const result = rows<AccountRow>(await request<unknown>("env_accounts", query(params), "PATCH", { role, company_id: companyId }, "return=representation"));
  if (!result.length) throw new EnvError("ACCOUNT_CONFLICT", "حساب تغییر کرده یا کاهش نقش مدیر مجاز نیست.", 409);
  if (result.length !== 1 || result[0].open_id !== openId) throw new EnvError("DATABASE_RESPONSE_INVALID", "پاسخ پایگاه داده معتبر نیست.", 503);
  return result[0];
}

/** New OAuth identities are registered as pending. Conflict handling never changes an existing role or company. */
export async function registerPendingAccount(identity: { openId: string; name: string | null; email: string | null }): Promise<void> {
  await request<unknown>("env_accounts", query({ on_conflict: "open_id" }), "POST", {
    open_id: identity.openId,
    name: identity.name,
    email: identity.email,
    role: "pending",
    company_id: null,
    created_at: new Date().toISOString(),
  }, "resolution=ignore-duplicates,return=minimal");
}

export async function findCompany(id: string): Promise<Company | undefined> {
  const result = rows<Company>(await request<unknown>("env_companies", query({ select: "id,name", id: `eq.${id}`, limit: "1" })));
  const company = result[0];
  if (!company) return undefined;
  if (company.id !== id || typeof company.name !== "string" || !company.name.trim()) {
    throw new EnvError("DATABASE_RESPONSE_INVALID", "اطلاعات شرکت معتبر نیست.", 503);
  }
  return company;
}

export async function saveCompany(id: string, name: string): Promise<Company> {
  const result = rows<Company>(await request<unknown>("env_companies", query({ on_conflict: "id", select: "id,name" }), "POST", { id, name }, "resolution=merge-duplicates,return=representation"));
  if (result.length !== 1 || result[0].id !== id || result[0].name !== name) throw new EnvError("DATABASE_RESPONSE_INVALID", "پاسخ پایگاه داده معتبر نیست.", 503);
  return result[0];
}

export async function listCompanies(companyId?: string): Promise<Company[]> {
  if (companyId) {
    const company = await findCompany(companyId);
    return company ? [company] : [];
  }
  const companies = await allRows<Company>("env_companies", { select: "id,name", order: "id.asc" });
  if (companies.some(company => typeof company.id !== "string" || !company.id.trim() || typeof company.name !== "string" || !company.name.trim())) {
    throw new EnvError("DATABASE_RESPONSE_INVALID", "اطلاعات شرکت معتبر نیست.", 503);
  }
  return companies;
}

export async function listReports(options: { companyId?: string; category?: string; period?: number; beforeYear?: number } = {}): Promise<Report[]> {
  const params: Record<string, string> = { select: REPORT_COLUMNS, order: "id.asc" };
  if (options.companyId !== undefined) params.company_id = `eq.${options.companyId}`;
  if (options.category !== undefined) params.category = `eq.${options.category}`;
  if (options.period !== undefined) params.period = `eq.${options.period}`;
  if (options.beforeYear !== undefined) params.year = `lt.${options.beforeYear}`;
  const result = await allRows<unknown>("env_reports", params);
  const reports = result.map(reportFromRow);
  if (options.companyId !== undefined && reports.some(report => report.companyId !== options.companyId)) {
    throw new EnvError("DATABASE_RESPONSE_INVALID", "پاسخ پایگاه داده معتبر نیست.", 503);
  }
  return reports;
}

/** Querying a non-admin report is scoped in PostgREST itself, not just after retrieval. */
export async function findReport(id: string, companyScope?: string): Promise<Report | undefined> {
  const params: Record<string, string> = { select: REPORT_COLUMNS, id: `eq.${id}`, limit: "1" };
  if (companyScope !== undefined) params.company_id = `eq.${companyScope}`;
  const result = rows<unknown>(await request<unknown>("env_reports", query(params)));
  if (result[0] === undefined) return undefined;
  const report = reportFromRow(result[0]);
  if (report.id !== id || (companyScope !== undefined && report.companyId !== companyScope)) return undefined;
  return report;
}

export async function insertReport(input: ReportInput, actorOpenId: string): Promise<Report> {
  const now = new Date().toISOString();
  const result = rows<unknown>(await request<unknown>("env_reports", query({ select: REPORT_COLUMNS }), "POST", {
    company_id: input.companyId,
    year: input.year,
    period: input.period,
    category: input.category,
    values: input.values,
    status: input.status,
    created_at: now,
    updated_at: now,
    updated_by: actorOpenId,
    revision: 1,
  }, "return=representation"));
  if (result.length !== 1) throw new EnvError("DATABASE_RESPONSE_INVALID", "پاسخ پایگاه داده معتبر نیست.", 503);
  return reportFromRow(result[0]);
}

/** PostgREST applies id + company + revision in a single UPDATE; zero rows is a conflict. */
export async function updateReport(input: ReportInput & { id: string; revision: number }, actorOpenId: string): Promise<Report> {
  const params = query({ select: REPORT_COLUMNS, id: `eq.${input.id}`, company_id: `eq.${input.companyId}`, revision: `eq.${input.revision}` });
  const result = rows<unknown>(await request<unknown>("env_reports", params, "PATCH", {
    year: input.year,
    period: input.period,
    category: input.category,
    values: input.values,
    status: input.status,
    updated_at: new Date().toISOString(),
    updated_by: actorOpenId,
    revision: input.revision + 1,
  }, "return=representation"));
  if (result.length === 0) throw reportConflict();
  if (result.length !== 1) throw new EnvError("DATABASE_RESPONSE_INVALID", "پاسخ پایگاه داده معتبر نیست.", 503);
  return reportFromRow(result[0]);
}
