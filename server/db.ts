import type { InsertUser } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { findAccount, findCompany, registerPendingAccount } from "./env/supabase";

/** Role and company are always resolved from trusted server configuration or the database. */
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

export async function getUserByOpenId(openId: string, identityName = ""): Promise<AuthUser | undefined> {
  if (!validIdentity(openId)) return undefined;
  const owner = ENV.ownerOpenId;
  if (validIdentity(owner) && openId === owner) {
    return { openId, name: identityName, email: null, role: "admin" };
  }
  const account = await findAccount(openId);
  if (!account || account.open_id !== openId) return undefined;
  const name = typeof account.name === "string" && account.name ? account.name : identityName;
  const email = typeof account.email === "string" ? account.email : null;
  // Organization-wide administrators need no company assignment.
  if (account.role === "admin") return { openId, name, email, role: "admin" };
  // Unassigned, unknown, or invalid roles never acquire permissions.
  if (account.role !== "company" || !validIdentity(account.company_id)) {
    return { openId, name, email, role: "pending" };
  }
  const company = await findCompany(account.company_id);
  if (!company) return { openId, name, email, role: "pending" };
  return { openId, name, email, role: "user", companyId: company.id };
}

/** Called only after the real Manus token exchange. Never updates roles or company assignments. */
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!validIdentity(user.openId)) throw new Error("Invalid identity");
  // The configured owner needs no membership record; all other identities start pending.
  const owner = ENV.ownerOpenId;
  if (validIdentity(owner) && user.openId === owner) return;
  await registerPendingAccount({
    openId: user.openId,
    name: typeof user.name === "string" ? user.name.slice(0, 200) : null,
    email: typeof user.email === "string" ? user.email.slice(0, 320) : null,
  });
}
