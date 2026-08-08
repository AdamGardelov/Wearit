import { useCallback, useEffect, useMemo, useState } from "react";
import { App } from "../App.jsx";
import { createSharingRepository } from "../data/sharingRepository.js";
import { AccountPanel } from "../features/account/AccountPanel.jsx";
import { GuestWardrobeView } from "../features/wardrobe/GuestWardrobeView.jsx";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "./AuthProvider.jsx";

function ownWardrobe(user) {
  return {
    ownerId: user.id,
    displayName: user.user_metadata?.name || user.email?.split("@")[0] || "Min garderob",
    isOwner: true,
  };
}

export function AuthenticatedApp({ client = supabase }) {
  const { user, signOut } = useAuth();
  const sharingRepository = useMemo(() => createSharingRepository(client), [client]);
  const fallbackWardrobe = useMemo(() => ownWardrobe(user), [user]);
  const [wardrobes, setWardrobes] = useState([fallbackWardrobe]);
  const [currentOwnerId, setCurrentOwnerId] = useState(user.id);
  const [accessError, setAccessError] = useState("");

  const refreshWardrobes = useCallback(async () => {
    setAccessError("");
    try {
      const accessible = await sharingRepository.listAccessibleWardrobes();
      const next = accessible.length ? accessible : [fallbackWardrobe];
      setWardrobes(next);
      setCurrentOwnerId((current) => (
        next.some((wardrobe) => wardrobe.ownerId === current) ? current : user.id
      ));
      return next;
    } catch (error) {
      setWardrobes([fallbackWardrobe]);
      setCurrentOwnerId(user.id);
      setAccessError(error.message || "Kunde inte ladda delade garderober.");
      return [fallbackWardrobe];
    }
  }, [fallbackWardrobe, sharingRepository, user.id]);

  useEffect(() => {
    refreshWardrobes();
  }, [refreshWardrobes]);

  const currentWardrobe = wardrobes.find((wardrobe) => wardrobe.ownerId === currentOwnerId)
    ?? fallbackWardrobe;

  return (
    <>
      {currentWardrobe.isOwner ? (
        <App />
      ) : (
        <GuestWardrobeView client={client} wardrobe={currentWardrobe} />
      )}
      <AccountPanel
        user={user}
        client={client}
        sharingRepository={sharingRepository}
        wardrobes={wardrobes}
        currentOwnerId={currentOwnerId}
        accessError={accessError}
        onSelectWardrobe={setCurrentOwnerId}
        onWardrobesChanged={refreshWardrobes}
        onSignOut={signOut}
      />
    </>
  );
}
