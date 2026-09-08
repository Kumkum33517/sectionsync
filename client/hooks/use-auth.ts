/**
 * useAuth — Supabase Auth hook.
 *
 * Reads the session from Supabase (persisted in localStorage via pkce flow).
 * Role is determined server-side by checking the admins table.
 * Never trusts client-side state for admin authorization.
 */
import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type Role = "admin" | "student" | null;

export interface AuthState {
  session:         Session | null;
  user:            User | null;
  role:            Role;
  loading:         boolean;
  isAuthenticated: boolean;
}

export function useAuth(): AuthState & { signOut: () => Promise<void> } {
  const [session, setSession] = useState<Session | null>(null);
  const [role,    setRole]    = useState<Role>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get the initial session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Derive role from session — checks admins table
  useEffect(() => {
    if (!session?.user?.email) { setRole(null); return; }

    const email = session.user.email.toLowerCase();
    supabase
      .from("admins")
      .select("id")
      .eq("email", email)
      .maybeSingle()
      .then(({ data }) => setRole(data ? "admin" : "student"));
  }, [session]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setRole(null);
  };

  return {
    session,
    user:            session?.user ?? null,
    role,
    loading,
    isAuthenticated: !!session,
    signOut,
  };
}
