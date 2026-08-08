import React from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "./auth/AuthProvider.jsx";
import { AuthenticatedApp } from "./auth/AuthenticatedApp.jsx";
import { LoginScreen, PasswordRecoveryScreen } from "./auth/LoginScreen.jsx";
import "./styles.css";

function AuthGate() {
  const { finishPasswordRecovery, loading, passwordRecovery, session } = useAuth();

  if (loading) {
    return (
      <main aria-busy="true">
        <p>Loading your wardrobe…</p>
      </main>
    );
  }

  if (!session) return <LoginScreen />;
  if (passwordRecovery) {
    return <PasswordRecoveryScreen onComplete={finishPasswordRecovery} />;
  }
  return <AuthenticatedApp />;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
