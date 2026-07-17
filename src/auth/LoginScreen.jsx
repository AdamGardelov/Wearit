import { useState } from "react";
import { supabase } from "../lib/supabase.js";

const SUCCESS_MESSAGE = "Check your email for the private sign-in link.";
const FALLBACK_ERROR_MESSAGE = "Unable to send the sign-in link. Please try again.";

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
      <h1>Sign in to your wardrobe</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="email">Email</label>
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
          Email me a sign-in link
        </button>
      </form>
      {sent ? <p role="status">{SUCCESS_MESSAGE}</p> : null}
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
    </main>
  );
}
