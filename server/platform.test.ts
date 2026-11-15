import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./_core/env";

afterEach(() => { vi.unstubAllEnvs(); });
describe("Supabase Auth configuration", () => {
  it("uses the configured Supabase URL and a server-only service key", () => {
    vi.stubEnv("SUPABASE_URL", "https://project.example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-key");
    vi.stubEnv("SUPABASE_ADMIN_EMAIL", " ADMIN@example.com ");
    expect(ENV.supabaseUrl).toBe("https://project.example.supabase.co");
    expect(ENV.supabaseServiceRoleKey).toBe("server-only-test-key");
    expect(ENV.supabaseAdminEmail).toBe("admin@example.com");
  });
  it("defaults to the repository Supabase project when no server URL is supplied", () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_URL", "");
    expect(ENV.supabaseUrl).toBe("https://vcayskykkanmfanvjqlh.supabase.co");
  });
});
