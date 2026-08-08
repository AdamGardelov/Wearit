import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";

const AuthContext = createContext(null);

export function AuthProvider({ children, client = supabase }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [passwordRecovery, setPasswordRecovery] = useState(
    () => new URLSearchParams(window.location.search).has("password-recovery"),
  );

  useEffect(() => {
    let active = true;
    let receivedAuthEvent = false;

    const { data } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      receivedAuthEvent = true;
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      if (event === "SIGNED_OUT") setPasswordRecovery(false);
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
    passwordRecovery,
    finishPasswordRecovery: () => {
      setPasswordRecovery(false);
      if (window.location.search.includes("password-recovery")) {
        window.history.replaceState({}, "", window.location.pathname);
      }
    },
    signOut: () => client.auth.signOut(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used within AuthProvider.");
  return auth;
}
