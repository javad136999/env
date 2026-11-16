import { createClient } from "@supabase/supabase-js";
import { ForbiddenError } from "@shared/_core/errors";
import type { Request } from "express";
import * as db from "../db";
import { accessDenied } from "../env/errors";
import { ENV } from "./env";

export type SupabaseIdentity = { openId: string; name: string; email: string | null };
export type AuthenticatedUser = db.AuthUser;

let adminClient: ReturnType<typeof createClient> | null = null;
function getSupabaseAdminClient() {
  if (!ENV.supabaseUrl || !ENV.supabaseServiceRoleKey) return null;
  if (!adminClient) {
    adminClient = createClient(ENV.supabaseUrl, ENV.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }
  return adminClient;
}
function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 && token.length <= 8192 ? token : null;
}

class SupabaseAuthService {
  async verifyRequestSession(req: Request): Promise<SupabaseIdentity | null> {
    const token = getBearerToken(req);
    const supabase = getSupabaseAdminClient();
    if (!token || !supabase) return null;
    try {
      // getUser(token) checks the token with Supabase Auth; never trust decoded client claims.
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user?.id) return null;
      const user = data.user;
      const metadata = user.user_metadata ?? {};
      const rawName = metadata.full_name ?? metadata.name;
      const name = typeof rawName === "string" && rawName.trim()
        ? rawName.trim().slice(0, 200)
        : (user.email?.split("@")[0] ?? "کاربر").slice(0, 200);
      return {
        openId: user.id,
        name,
        email: typeof user.email === "string" ? user.email.trim().toLowerCase() : null,
      };
    } catch {
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<AuthenticatedUser> {
    const identity = await this.verifyRequestSession(req);
    if (!identity) throw ForbiddenError("Invalid Supabase access token");
    const user = await db.getUserByOpenId(identity.openId, identity.name, identity.email);
    if (!user || user.role === "pending") throw accessDenied();
    return user;
  }
}

export const sdk = new SupabaseAuthService();
