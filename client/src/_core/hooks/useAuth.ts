import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

type AppUser = { id: string; name: string; email: string | null };
type UseAuthOptions = { redirectOnUnauthenticated?: boolean; redirectPath?: string };
function toAppUser(user: User | null): AppUser | null {
  if (!user) return null;
  const metadata = user.user_metadata ?? {};
  const name = typeof metadata.full_name === "string" ? metadata.full_name : typeof metadata.name === "string" ? metadata.name : user.email?.split("@")[0] ?? "کاربر";
  return { id: user.id, name, email: user.email ?? null };
}

export function useAuth(options?: UseAuthOptions) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true;
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError);
      setUser(toAppUser(data.session?.user ?? null));
      setLoading(false);
    }).catch(reason => { if (active) { setError(reason instanceof Error ? reason : new Error("خطای نشست")); setLoading(false); } });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) { setUser(toAppUser(session?.user ?? null)); setLoading(false); }
    });
    return () => { active = false; subscription.subscription.unsubscribe(); };
  }, []);
  const logout = useCallback(async () => {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw signOutError;
    setUser(null);
  }, []);
  useEffect(() => {
    if (!options?.redirectOnUnauthenticated || loading || user || !options.redirectPath) return;
    if (window.location.pathname !== options.redirectPath) window.location.assign(options.redirectPath);
  }, [loading, options?.redirectOnUnauthenticated, options?.redirectPath, user]);
  return { user, loading, error, isAuthenticated: Boolean(user), refresh: async () => { if (!supabase) return null; const { data } = await supabase.auth.getUser(); const next = toAppUser(data.user); setUser(next); return next; }, logout };
}
