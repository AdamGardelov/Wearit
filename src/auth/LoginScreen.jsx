import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import "./auth.css";

const PASSWORD_ERROR_MESSAGE = "Fel e-postadress eller lösenord.";
const MAGIC_ERROR_MESSAGE = "Kunde inte skicka inloggningslänken. Försök igen.";
const RECOVERY_ERROR_MESSAGE = "Kunde inte skicka återställningslänken. Försök igen.";

export function LoginScreen({ client = supabase }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [pendingAction, setPendingAction] = useState("");

  const normalizedEmail = () => email.trim();

  async function signInWithPassword(event) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    setPendingAction("password");

    try {
      const { error } = await client.auth.signInWithPassword({
        email: normalizedEmail(),
        password,
      });
      if (error) setErrorMessage(PASSWORD_ERROR_MESSAGE);
    } catch {
      setErrorMessage(PASSWORD_ERROR_MESSAGE);
    } finally {
      setPendingAction("");
    }
  }

  async function sendMagicLink() {
    if (!normalizedEmail()) {
      setErrorMessage("Ange din e-postadress först.");
      return;
    }
    setErrorMessage("");
    setStatusMessage("");
    setPendingAction("magic");

    try {
      const { error } = await client.auth.signInWithOtp({
        email: normalizedEmail(),
        options: {
          emailRedirectTo: window.location.origin,
          shouldCreateUser: false,
        },
      });
      if (error) setErrorMessage(MAGIC_ERROR_MESSAGE);
      else setStatusMessage("Kolla din e-post för inloggningslänken.");
    } catch {
      setErrorMessage(MAGIC_ERROR_MESSAGE);
    } finally {
      setPendingAction("");
    }
  }

  async function sendPasswordRecovery() {
    if (!normalizedEmail()) {
      setErrorMessage("Ange din e-postadress först.");
      return;
    }
    setErrorMessage("");
    setStatusMessage("");
    setPendingAction("recovery");

    try {
      const { error } = await client.auth.resetPasswordForEmail(normalizedEmail(), {
        redirectTo: `${window.location.origin}/?password-recovery=1`,
      });
      if (error) setErrorMessage(RECOVERY_ERROR_MESSAGE);
      else setStatusMessage("Kolla din e-post för att skapa eller återställa lösenordet.");
    } catch {
      setErrorMessage(RECOVERY_ERROR_MESSAGE);
    } finally {
      setPendingAction("");
    }
  }

  const pending = Boolean(pendingAction);

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="login-heading">
        <p className="auth-kicker">Wearit</p>
        <h1 id="login-heading">Logga in till din garderob</h1>
        <p className="auth-intro">Använd lösenord eller få en engångslänk via e-post.</p>

        <form className="auth-form" onSubmit={signInWithPassword}>
          <label htmlFor="email">E-post</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label htmlFor="password">Lösenord</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button className="auth-primary" type="submit" disabled={pending}>
            {pendingAction === "password" ? "Loggar in…" : "Logga in"}
          </button>
        </form>

        <button
          className="auth-text-action"
          type="button"
          onClick={sendPasswordRecovery}
          disabled={pending}
        >
          {pendingAction === "recovery" ? "Skickar…" : "Skapa eller återställ lösenord"}
        </button>

        <div className="auth-divider"><span>eller</span></div>

        <button
          className="auth-secondary"
          type="button"
          onClick={sendMagicLink}
          disabled={pending}
        >
          {pendingAction === "magic" ? "Skickar…" : "Skicka magic link"}
        </button>

        {statusMessage ? <p className="auth-status" role="status">{statusMessage}</p> : null}
        {errorMessage ? <p className="auth-error" role="alert">{errorMessage}</p> : null}
      </section>
    </main>
  );
}

export function PasswordRecoveryScreen({ client = supabase, onComplete }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function updatePassword(event) {
    event.preventDefault();
    setErrorMessage("");

    if (password.length < 8) {
      setErrorMessage("Lösenordet måste vara minst 8 tecken.");
      return;
    }
    if (password !== confirmation) {
      setErrorMessage("Lösenorden matchar inte.");
      return;
    }

    setPending(true);
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) setErrorMessage(error.message || "Kunde inte spara lösenordet.");
      else onComplete?.();
    } catch {
      setErrorMessage("Kunde inte spara lösenordet. Försök igen.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="password-heading">
        <p className="auth-kicker">Wearit</p>
        <h1 id="password-heading">Välj ett nytt lösenord</h1>
        <p className="auth-intro">Minst 8 tecken. Använd gärna en lösenordshanterare.</p>
        <form className="auth-form" onSubmit={updatePassword}>
          <label htmlFor="new-password">Nytt lösenord</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength="8"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <label htmlFor="confirm-password">Upprepa lösenord</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            minLength="8"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
          <button className="auth-primary" type="submit" disabled={pending}>
            {pending ? "Sparar…" : "Spara lösenord"}
          </button>
        </form>
        {errorMessage ? <p className="auth-error" role="alert">{errorMessage}</p> : null}
      </section>
    </main>
  );
}
