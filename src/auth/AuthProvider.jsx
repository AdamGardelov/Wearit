import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";

const AuthContext = createContext(null);

export function AuthProvider({ children, client = supabase }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);

  useEffect(() => {
    let active = true;
    let receivedAuthEvent = false;

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      receivedAuthEvent = true;
      setSession(nextSession);
      setLoading(false);
    });

    let initialSession;
    try {
      initialSession = client.auth.getSession();
    } catch {
      if (active) setLoading(false);
    }

    Promise.resolve(initialSession)
      .then((result) => {
        if (!active) return;
        if (!receivedAuthEvent) setSession(result?.data?.session ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  const value = {
    loading,
    session,
    user: session?.user ?? null,
    signOut: () => client.auth.signOut(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used within AuthProvider.");
  return auth;
}
