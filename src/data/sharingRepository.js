function dataOrThrow(result) {
  if (result.error) throw result.error;
  return result.data;
}

function mapWardrobe(row) {
  return {
    ownerId: row.owner_id,
    displayName: row.display_name,
    isOwner: row.is_owner,
  };
}

function mapGuest(row) {
  return {
    id: row.guest_id,
    displayName: row.display_name,
    email: row.email,
    grantedAt: row.granted_at,
  };
}

export function createSharingRepository(client) {
  return {
    async listAccessibleWardrobes() {
      const rows = dataOrThrow(await client.rpc("list_accessible_wardrobes")) || [];
      return rows.map(mapWardrobe);
    },

    async listGuests() {
      const rows = dataOrThrow(await client.rpc("list_wardrobe_guests")) || [];
      return rows.map(mapGuest);
    },

    async grantGuest(email) {
      return dataOrThrow(await client.rpc("grant_wardrobe_guest", {
        p_email: email.trim(),
      }));
    },

    async revokeGuest(guestId) {
      return dataOrThrow(await client.rpc("revoke_wardrobe_guest", {
        p_guest_id: guestId,
      }));
    },
  };
}
