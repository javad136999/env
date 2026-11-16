// Supabase Auth and database settings used by the application.
const defaultSupabaseUrl = "https://vcayskykkanmfanvjqlh.supabase.co";
export const ENV = {
  get supabaseUrl() { return process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || defaultSupabaseUrl; },
  get supabaseServiceRoleKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""; },
  get supabaseAdminEmail() { return (process.env.SUPABASE_ADMIN_EMAIL ?? "").trim().toLowerCase(); },
  // Retained for other pre-existing optional integrations; none are used for login.
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  get ownerOpenId() { return process.env.OWNER_OPEN_ID ?? ""; },
  get forgeApiUrl() { return process.env.MANUS_API_URL ?? ""; },
  get forgeApiKey() { return process.env.MANUS_API_KEY ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
};
