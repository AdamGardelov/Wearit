import { useEffect, useRef, useState } from "react";
import { SignOut, Trash, UserCircle, X } from "@phosphor-icons/react";
import "./account.css";

export function AccountPanel({
  user,
  client,
  sharingRepository,
  wardrobes,
  currentOwnerId,
  accessError = "",
  onSelectWardrobe,
  onWardrobesChanged,
  onSignOut,
}) {
  const [open, setOpen] = useState(false);
  const [guests, setGuests] = useState([]);
  const [guestsLoading, setGuestsLoading] = useState(false);
  const [guestEmail, setGuestEmail] = useState("");
  const [guestError, setGuestError] = useState("");
  const [guestStatus, setGuestStatus] = useState("");
  const [guestBusy, setGuestBusy] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordStatus, setPasswordStatus] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const closeButtonRef = useRef(null);

  const currentWardrobe = wardrobes.find((wardrobe) => wardrobe.ownerId === currentOwnerId)
    ?? wardrobes[0];

  async function loadGuests() {
    setGuestsLoading(true);
    setGuestError("");
    try {
      setGuests(await sharingRepository.listGuests());
    } catch (error) {
      setGuestError(error.message || "Kunde inte ladda gästerna.");
    } finally {
      setGuestsLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    loadGuests();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function grantGuest(event) {
    event.preventDefault();
    const email = guestEmail.trim();
    if (!email) return;
    setGuestError("");
    setGuestStatus("");
    setGuestBusy("grant");
    try {
      await sharingRepository.grantGuest(email);
      setGuestEmail("");
      setGuestStatus(`${email} kan nu se din garderob.`);
      await Promise.all([loadGuests(), onWardrobesChanged?.()]);
    } catch (error) {
      setGuestError(error.message || "Kunde inte lägga till gästen.");
    } finally {
      setGuestBusy("");
    }
  }

  async function revokeGuest(guest) {
    setGuestError("");
    setGuestStatus("");
    setGuestBusy(guest.id);
    try {
      await sharingRepository.revokeGuest(guest.id);
      setGuests((current) => current.filter((entry) => entry.id !== guest.id));
      setGuestStatus(`${guest.displayName} har inte längre tillgång.`);
      await onWardrobesChanged?.();
    } catch (error) {
      setGuestError(error.message || "Kunde inte ta bort gästen.");
    } finally {
      setGuestBusy("");
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setPasswordError("");
    setPasswordStatus("");
    if (newPassword.length < 8) {
      setPasswordError("Lösenordet måste vara minst 8 tecken.");
      return;
    }
    if (newPassword !== passwordConfirmation) {
      setPasswordError("Lösenorden matchar inte.");
      return;
    }

    setPasswordBusy(true);
    try {
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword("");
      setPasswordConfirmation("");
      setPasswordStatus("Lösenordet är sparat.");
    } catch (error) {
      setPasswordError(error.message || "Kunde inte spara lösenordet.");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function signOut() {
    setSignOutError("");
    try {
      const result = await onSignOut();
      if (result?.error) throw result.error;
      setOpen(false);
    } catch (error) {
      setSignOutError(error.message || "Kunde inte logga ut.");
    }
  }

  return (
    <>
      <button
        className="account-launch"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Öppna konto och garderober"
      >
        <UserCircle size={20} weight="regular" aria-hidden="true" />
        <span>{currentWardrobe?.isOwner ? "Min garderob" : currentWardrobe?.displayName}</span>
      </button>

      {open && (
        <div className="account-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <aside className="account-panel" role="dialog" aria-modal="true" aria-labelledby="account-heading">
            <header className="account-heading">
              <div>
                <p>Konto</p>
                <h2 id="account-heading">{user.email}</h2>
              </div>
              <button ref={closeButtonRef} type="button" onClick={() => setOpen(false)} aria-label="Stäng konto">
                <X size={22} weight="light" aria-hidden="true" />
              </button>
            </header>

            <section className="account-section" aria-labelledby="wardrobes-heading">
              <h3 id="wardrobes-heading">Visa garderob</h3>
              <div className="wardrobe-choices">
                {wardrobes.map((wardrobe) => (
                  <button
                    key={wardrobe.ownerId}
                    type="button"
                    className={wardrobe.ownerId === currentOwnerId ? "active" : ""}
                    aria-pressed={wardrobe.ownerId === currentOwnerId}
                    onClick={() => {
                      onSelectWardrobe(wardrobe.ownerId);
                      setOpen(false);
                    }}
                  >
                    <span>{wardrobe.isOwner ? "Min garderob" : wardrobe.displayName}</span>
                    <small>{wardrobe.isOwner ? "Ägare" : "Gäst"}</small>
                  </button>
                ))}
              </div>
              {accessError && <p className="account-error" role="alert">{accessError}</p>}
            </section>

            <section className="account-section" aria-labelledby="sharing-heading">
              <h3 id="sharing-heading">Dela min garderob</h3>
              <p className="account-help">
                Gästen får en läsvy av dina plagg och bilder. E-postadressen måste redan ha ett Wearit-konto.
              </p>
              <form className="guest-form" onSubmit={grantGuest}>
                <label htmlFor="guest-email">Gästens e-post</label>
                <div>
                  <input
                    id="guest-email"
                    type="email"
                    autoComplete="email"
                    value={guestEmail}
                    onChange={(event) => setGuestEmail(event.target.value)}
                    disabled={Boolean(guestBusy)}
                    required
                  />
                  <button type="submit" disabled={Boolean(guestBusy)}>
                    {guestBusy === "grant" ? "Lägger till…" : "Lägg till"}
                  </button>
                </div>
              </form>

              {guestsLoading ? <p className="account-help">Laddar gäster…</p> : null}
              {!guestsLoading && guests.length ? (
                <ul className="guest-list">
                  {guests.map((guest) => (
                    <li key={guest.id}>
                      <span><strong>{guest.displayName}</strong><small>{guest.email}</small></span>
                      <button
                        type="button"
                        onClick={() => revokeGuest(guest)}
                        disabled={Boolean(guestBusy)}
                        aria-label={`Ta bort ${guest.displayName} som gäst`}
                      >
                        <Trash size={17} weight="regular" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {!guestsLoading && !guests.length ? <p className="account-help">Inga gäster ännu.</p> : null}
              {guestStatus && <p className="account-status" role="status">{guestStatus}</p>}
              {guestError && <p className="account-error" role="alert">{guestError}</p>}
            </section>

            <section className="account-section" aria-labelledby="password-change-heading">
              <h3 id="password-change-heading">Byt eller skapa lösenord</h3>
              <form className="password-form" onSubmit={changePassword}>
                <label htmlFor="account-password">Nytt lösenord</label>
                <input
                  id="account-password"
                  type="password"
                  autoComplete="new-password"
                  minLength="8"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  disabled={passwordBusy}
                  required
                />
                <label htmlFor="account-password-confirmation">Upprepa lösenord</label>
                <input
                  id="account-password-confirmation"
                  type="password"
                  autoComplete="new-password"
                  minLength="8"
                  value={passwordConfirmation}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  disabled={passwordBusy}
                  required
                />
                <button type="submit" disabled={passwordBusy}>
                  {passwordBusy ? "Sparar…" : "Spara lösenord"}
                </button>
              </form>
              {passwordStatus && <p className="account-status" role="status">{passwordStatus}</p>}
              {passwordError && <p className="account-error" role="alert">{passwordError}</p>}
            </section>

            <footer className="account-footer">
              <button type="button" onClick={signOut}>
                <SignOut size={18} weight="regular" aria-hidden="true" />
                Logga ut
              </button>
              {signOutError && <p className="account-error" role="alert">{signOutError}</p>}
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}
