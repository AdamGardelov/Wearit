import { useState } from "react";
import { supabase } from "../lib/supabase.js";

const SUCCESS_MESSAGE = "Kolla din e-post för inloggningslänken.";
const FALLBACK_ERROR_MESSAGE = "Kunde inte skicka länken. Försök igen.";

export function LoginScreen({ client = supabase }) {
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage("");
    setSent(false);
    setPending(true);

    try {
      const { error } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: window.location.origin,
          shouldCreateUser: false,
        },
      });

      if (error) {
        setErrorMessage(error.message || FALLBACK_ERROR_MESSAGE);
      } else {
        setSent(true);
      }
    } catch {
      setErrorMessage(FALLBACK_ERROR_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <h1>Logga in till din garderob</h1>
      <form onSubmit={handleSubmit}>
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
        <button type="submit" disabled={pending}>
          Skicka inloggningslänk
        </button>
      </form>
      {sent ? <p role="status">{SUCCESS_MESSAGE}</p> : null}
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
    </main>
  );
}
