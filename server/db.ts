import { ENV } from "./_core/env";
import { findAccount, findCompany, registerPendingAccount } from "./env/supabase";
/** Application authorization is tied to the immutable Supabase Auth user UUID. */
export type AuthUser = {
  openId: string;
  name: string;
  email: string | null;
  role: "admin" | "user" | "pending";
  companyId?: string;
  isCron?: boolean;
  taskUid?: string;
};
function validIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}
export async function getUserByOpenId(openId: string, identityName = "", identityEmail: string | null = null): Promise<AuthUser | undefined> {
  if (!validIdentity(openId)) return undefined;
  const normalizedEmail = typeof identityEmail === "string" ? identityEmail.trim().toLowerCase() : null;
  if (normalizedEmail && ENV.supabaseAdminEmail && normalizedEmail === ENV.supabaseAdminEmail) {
    return { openId, name: identityName || normalizedEmail, email: normalizedEmail, role: "admin" };
  }
  const account = await findAccount(openId);
  if (!account || account.open_id !== openId) return undefined;
  const name = typeof account.name === "string" && account.name ? account.name : identityName;
  const email = typeof account.email === "string" ? account.email : normalizedEmail;
  if (account.role === "admin") return { openId, name, email, role: "admin" };
  if (account.role !== "company" || !validIdentity(account.company_id)) {
    return { openId, name, email, role: "pending" };
  }
  const company = await findCompany(account.company_id);
  if (!company) return { openId, name, email, role: "pending" };
  return { openId, name, email, role: "user", companyId: company.id };
}
/** New authenticated users are registered with the least-privileged role. */
export async function upsertUser(user: { openId: string; name?: string | null; email?: string | null }): Promise<void> {
  if (!validIdentity(user.openId)) throw new Error("Invalid identity");
  if (user.email?.trim().toLowerCase() === ENV.supabaseAdminEmail && ENV.supabaseAdminEmail) return;
  await registerPendingAccount({
    openId: user.openId,
    name: typeof user.name === "string" ? user.name.slice(0, 200) : null,
    email: typeof user.email === "string" ? user.email.slice(0, 320) : null,
  });
}
