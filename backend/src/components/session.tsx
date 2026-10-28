"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";

export interface Session {
  mode: "demo" | "supabase";
  user: { id: string; email: string; name: string } | null;
  terms: { current_version: string; accepted: boolean; data_use: boolean };
  is_admin?: boolean;
  supabase: { url: string; anon_key: string } | null;
  /** /api/session을 불러오지 못함 (서버 설정 누락 등) */
  unavailable?: boolean;
}

const Ctx = createContext<{ session: Session | null; refresh: () => Promise<void>; signOut: () => Promise<void> }>({
  session: null,
  refresh: async () => {},
  signOut: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const refresh = useCallback(async () => {
    try {
      setSession(await api<Session>("/api/session"));
    } catch {
      setSession({ mode: "supabase", user: null, terms: { current_version: "", accepted: false, data_use: false }, supabase: null, unavailable: true });
    }
  }, []);
  const signOut = useCallback(async () => {
    if (session?.mode === "demo") await api("/api/dev/logout", { method: "POST" });
    else if (session?.supabase) {
      const { createBrowserClient } = await import("@supabase/ssr");
      await createBrowserClient(session.supabase.url, session.supabase.anon_key).auth.signOut();
    }
    await refresh();
    window.location.href = "/";
  }, [session, refresh]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return <Ctx.Provider value={{ session, refresh, signOut }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
