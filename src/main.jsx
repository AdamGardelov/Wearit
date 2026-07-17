import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { AuthProvider, useAuth } from "./auth/AuthProvider.jsx";
import { LoginScreen } from "./auth/LoginScreen.jsx";
import "./styles.css";

function AuthGate() {
  const { loading, session } = useAuth();

  if (loading) {
    return (
      <main aria-busy="true">
        <p>Loading your wardrobe…</p>
      </main>
    );
  }

  if (!session) return <LoginScreen />;
  return <App />;
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
