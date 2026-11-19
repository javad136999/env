import type { Express, Request, Response } from "express";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { parse as parseCookie } from "cookie";
import { SignJWT, jwtVerify } from "jose";
import * as db from "../db";
import { sdk, type SupabaseIdentity } from "../_core/sdk";
import { ENV } from "../_core/env";
import { EnvError, accessDenied, notConfigured, reportConflict } from "./errors";
import { assertLegacyValuesUnchanged, parseReport, preserveLegacyValues, reportsCsv, reportWarnings } from "./reports";
import { findAccount, findAccountByUsername, findCompany, findReport, hasSupabaseConfiguration, insertReport, listAccounts, listCompanies, listReports, saveCompany, setAccountCredentials, setAccountMembership, setAccountPassword, updateReport, type AccountRow } from "./supabase";

function sendError(res: Response, error: unknown, extra: Record<string, unknown> = {}) {
  const safe = error instanceof EnvError ? error : new EnvError("INTERNAL_ERROR", "خطای داخلی در پردازش درخواست.", 500);
  res.status(safe.status).json({ ...extra, error: { code: safe.code, message: safe.message } });
}
function noSession() { return new EnvError("UNAUTHENTICATED", "برای ادامه با ایمیل و رمز عبور وارد حساب Supabase شوید.", 401); }
function noStore(res: Response) {
  res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization" });
}
function publicUser(user: db.AuthUser) {
  const role = user.role === "admin" ? "admin" as const : user.role === "user" ? "company" as const : "pending" as const;
  return { name: user.name, role, ...(role !== "pending" && user.companyId ? { companyId: user.companyId } : {}) };
}
const LOCAL_COOKIE = "env_local_session";
const LOCAL_SESSION_MS = 1000 * 60 * 60 * 12;
function localKey() { return new TextEncoder().encode(process.env.MANUS_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ""); }
function localCookie(req: Request) { return parseCookie(req.headers.cookie || "")[LOCAL_COOKIE]; }
async function localIdentity(req: Request): Promise<SupabaseIdentity | null> {
  const token = localCookie(req);
  if (!token || !localKey().length) return null;
  try { const { payload } = await jwtVerify(token, localKey(), { algorithms: ["HS256"] }); const p = payload as Record<string, unknown>; if (typeof p.openId !== "string" || typeof p.name !== "string" || typeof p.email !== "string") return null; return { openId: p.openId, name: p.name, email: p.email || null }; } catch { return null; }
}
function setLocalCookie(res: Response, token: string) { res.setHeader("Set-Cookie", `${LOCAL_COOKIE}=${token}; Max-Age=${LOCAL_SESSION_MS / 1000}; Path=/; HttpOnly; SameSite=None; Secure`); }
function clearLocalCookie(res: Response) { res.setHeader("Set-Cookie", `${LOCAL_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=None; Secure`); }
function hashPassword(password: string): string { const salt = randomBytes(16); const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }); return `scrypt$16384$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`; }
function verifyPassword(password: string, encoded: string | null): boolean { if (!encoded) return false; const parts = encoded.split("$"); if (parts.length !== 6 || parts[0] !== "scrypt") return false; const [, n, r, p, saltText, hashText] = parts; const salt = Buffer.from(saltText, "base64url"); const expected = Buffer.from(hashText, "base64url"); if (!salt.length || expected.length !== 64 || n !== "16384" || r !== "8" || p !== "1") return false; const actual = scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 }); return actual.length === expected.length && timingSafeEqual(actual, expected); }
async function identityWithSource(req: Request): Promise<{ session: SupabaseIdentity; local: boolean }> { const local = await localIdentity(req); if (local && !local.openId.startsWith("cron_")) return { session: local, local: true }; const session = await sdk.verifyRequestSession(req); if (!session || session.openId.startsWith("cron_")) throw noSession(); return { session, local: false }; }
async function identity(req: Request): Promise<SupabaseIdentity> {
  return (await identityWithSource(req)).session;
}
async function account(session: SupabaseIdentity): Promise<db.AuthUser> {
  const existing = await db.getUserByOpenId(session.openId, session.name, session.email);
  if (existing) return existing;
  // A verified Supabase Auth identity receives a pending account until an administrator assigns access.
  // Create only an unassigned pending account, never membership or privilege.
  await db.upsertUser({ openId: session.openId, name: session.name || null, email: session.email });
  const registered = await db.getUserByOpenId(session.openId, session.name, session.email);
  if (!registered) throw new EnvError("DATABASE_ERROR", "ثبت حساب در پایگاه داده ناموفق بود.", 503);
  return registered;
}
async function authorized(session: SupabaseIdentity): Promise<db.AuthUser> {
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
    (row.company_id !== null && !validText(row.company_id, 200)) ||
    (row.username !== undefined && row.username !== null && !validText(row.username, 120))) {
    throw new EnvError("DATABASE_RESPONSE_INVALID", "اطلاعات حساب معتبر نیست.", 503);
  }
  return { openId: row.open_id, name: row.name, email: row.email, username: row.username ?? null, role: row.role, companyId: row.company_id };
}

export function registerEnvRoutes(app: Express) {
  app.post("/api/env/auth/login", async (req, res) => {
    noStore(res);
    try {
      if (!hasSupabaseConfiguration()) throw notConfigured();
      const body: unknown = req.body;
      if (!validObject(body) || Object.keys(body).some(key => !["username", "password", "portal"].includes(key)) || !validText(body.username, 120) || typeof body.password !== "string" || body.password.length < 1 || body.password.length > 256 || (body.portal !== undefined && body.portal !== "company" && body.portal !== "admin")) throw new EnvError("LOGIN_INVALID", "نام کاربری و رمز عبور معتبر نیستند.", 400);
      const found = await findAccountByUsername(body.username);
      if (!found || !verifyPassword(body.password, found.password_hash)) throw new EnvError("LOGIN_FAILED", "نام کاربری یا رمز عبور نادرست است.", 401);
      if (body.portal === "company" && found.role !== "company") throw new EnvError("PORTAL_ROLE_MISMATCH", "این حساب برای ورود مدیریت ثبت شده است.", 403);
      if (body.portal === "admin" && found.role !== "admin") throw new EnvError("PORTAL_ROLE_MISMATCH", "این حساب برای ورود شرکت ثبت شده است.", 403);
      if (!process.env.MANUS_JWT_SECRET && !process.env.SUPABASE_SERVICE_ROLE_KEY) throw notConfigured();
      const token = await new SignJWT({ openId: found.open_id, appId: "local", name: body.username, email: found.email ?? "" }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(Math.floor((Date.now() + LOCAL_SESSION_MS) / 1000)).sign(localKey());
      setLocalCookie(res, token);
      const user = await account({ openId: found.open_id, name: found.name || body.username, email: found.email });
      res.json({ user: publicUser(user), mustChangePassword: found.must_change_password === true });
    } catch (error) { sendError(res, error); }
  });
  app.post("/api/env/auth/logout", async (_req, res) => { noStore(res); clearLocalCookie(res); res.json({ ok: true }); });
  app.post("/api/env/auth/change-password", async (req, res) => {
    noStore(res);
    try {
      const source = await identityWithSource(req);
      if (!source.local) throw new EnvError("LOCAL_SESSION_REQUIRED", "برای تغییر رمز باید با حساب محلی وارد شوید.", 401);
      const body: unknown = req.body;
      if (!validObject(body) || Object.keys(body).some(key => key !== "password" && key !== "currentPassword") || typeof body.password !== "string" || body.password.length < 8 || body.password.length > 256 || typeof body.currentPassword !== "string") throw new EnvError("PASSWORD_INVALID", "رمز جدید باید حداقل ۸ نویسه باشد.", 400);
      const found = await findAccountByUsername(source.session.name);
      if (!found || found.open_id !== source.session.openId || !verifyPassword(body.currentPassword, found.password_hash)) throw new EnvError("PASSWORD_CURRENT_INVALID", "رمز فعلی نادرست است.", 401);
      await setAccountPassword(found.open_id, hashPassword(body.password), false);
      res.json({ user: publicUser(await account(source.session)), mustChangePassword: false });
    } catch (error) { sendError(res, error); }
  });
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

  app.post("/api/env/admin/accounts/credentials", async (req, res) => {
    noStore(res);
    try {
      if (!req.is("application/json")) throw new EnvError("CONTENT_TYPE_INVALID", "درخواست باید application/json باشد.", 415);
      await requireAdmin(req);
      const body: unknown = req.body;
      if (!validObject(body) || Object.keys(body).some(key => !["openId", "username", "password"].includes(key)) ||
        !validText(body.openId, 200) || !validText(body.username, 120) ||
        (body.password !== undefined && body.password !== null && (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 256))) {
        throw new EnvError("CREDENTIALS_INVALID", "نام کاربری معتبر و رمز جدید حداقل ۸ نویسه‌ای وارد کنید.", 400);
      }
      const existing = await findAccount(body.openId);
      if (!existing || existing.open_id !== body.openId) throw new EnvError("ACCOUNT_NOT_FOUND", "حساب مورد نظر وجود ندارد.", 404);
      const duplicate = await findAccountByUsername(body.username);
      if (duplicate && duplicate.open_id !== body.openId) throw new EnvError("USERNAME_TAKEN", "این نام کاربری قبلاً استفاده شده است.", 409);
      const updated = await setAccountCredentials(body.openId, body.username, typeof body.password === "string" && body.password ? hashPassword(body.password) : undefined);
      res.json({ account: adminAccount(updated) });
    } catch (error) { sendError(res, error); }
  });

  app.get("/api/env/context", async (req, res) => {
    noStore(res);
    let session: SupabaseIdentity | null = null;
    let local = false;
    try {
      const source = await identityWithSource(req);
      session = source.session;
      local = source.local;
      if (!session) {
        res.json({ authenticated: false, configured: hasSupabaseConfiguration() });
        return;
      }
      if (!hasSupabaseConfiguration()) throw notConfigured();
      const user = await account(session);
      if (user.role === "pending") {
        // Do not query or expose any company or report data for pending identities.
        res.json({ authenticated: true, configured: true, user: publicUser(user), ...(local ? { mustChangePassword: false } : {}) });
        return;
      }
      const companyId = user.role === "admin" ? undefined : user.companyId;
      if (user.role !== "admin" && !companyId) throw accessDenied();
      const [companies, reports] = await Promise.all([listCompanies(companyId), listReports({ companyId })]);
      let mustChangePassword = false;
      if (local) {
        const localAccount = await findAccountByUsername(session.name);
        mustChangePassword = localAccount?.open_id === session.openId && localAccount.must_change_password === true;
      }
      res.json({ authenticated: true, configured: true, user: publicUser(user), companies, reports, ...(local ? { mustChangePassword } : {}) });
  } catch (error) {
      if (error instanceof EnvError && error.code === "UNAUTHENTICATED") {
        res.json({ authenticated: false, configured: hasSupabaseConfiguration() });
        return;
      }
      sendError(res, error, { authenticated: !!session, configured: hasSupabaseConfiguration() });
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
