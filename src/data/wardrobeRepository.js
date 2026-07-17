import { slotForCategory } from "../domain/slots.js";

const OUTFIT_SELECT = "*, outfit_items(*, wardrobe_item:wardrobe_items(*))";
const WEAR_HISTORY_SELECT =
  "*, outfit:outfits(id, name), wear_event_items(*, wardrobe_item:wardrobe_items(id, name, status))";

function dataOrThrow(result) {
  if (result.error) throw result.error;
  return result.data;
}

function orderedOutfitItems(rows = []) {
  return rows
    .filter((row) => row.wardrobe_item)
    .sort((left, right) => (
      left.layer_order - right.layer_order
      || String(left.wardrobe_item_id ?? left.wardrobe_item.id)
        .localeCompare(String(right.wardrobe_item_id ?? right.wardrobe_item.id))
    ))
    .map((row) => ({
      ...row.wardrobe_item,
      saved_slot: row.slot,
      saved_layer_order: row.layer_order,
    }));
}

export function createWardrobeRepository(client) {
  async function createSignedAssetUrls(paths, expiresIn = 3600) {
    if (!paths.length) return [];

    const signedAssets = dataOrThrow(
      await client.storage
        .from("wardrobe-assets")
        .createSignedUrls(paths, expiresIn),
    ) || [];

    const assetError = signedAssets.find((asset) => asset?.error)?.error;
    if (assetError) throw new Error(assetError);
    return signedAssets;
  }

  async function signOutfits(outfits) {
    const thumbnailPaths = outfits
      .map((outfit) => outfit.thumbnail_path)
      .filter(Boolean);
    const signedAssets = await createSignedAssetUrls(thumbnailPaths);
    const signedUrlByPath = new Map(
      signedAssets.map((asset) => [asset.path, asset.signedUrl]),
    );

    return outfits.map((outfit) => ({
      ...outfit,
      thumbnailUrl: outfit.thumbnail_path
        ? signedUrlByPath.get(outfit.thumbnail_path) ?? null
        : null,
      items: orderedOutfitItems(outfit.outfit_items),
    }));
  }

  async function listItems({ includeArchived = false } = {}) {
    let query = client
      .from("wardrobe_items")
      .select("*")
      .order("created_at", { ascending: false });

    if (!includeArchived) query = query.eq("status", "active");

    const items = dataOrThrow(await query) || [];
    const signedAssets = await createSignedAssetUrls(
      items.map((item) => item.cutout_path),
    );
    const signedUrlByPath = new Map(
      signedAssets.map((asset) => [asset.path, asset.signedUrl]),
    );

    return items.map((item) => ({
      ...item,
      cutoutUrl: signedUrlByPath.get(item.cutout_path) ?? null,
    }));
  }

  async function updateItem(item) {
    const slot = slotForCategory(item.category);
    if (!slot) throw new Error(`Category ${item.category} has no wardrobe slot.`);

    const payload = {
      name: item.name,
      category: item.category,
      slot,
      brand: item.brand,
      size: item.size,
      notes: item.notes,
      colors: item.colors,
      tags: item.tags,
      anchor_x: item.anchor_x,
      anchor_y: item.anchor_y,
      scale: item.scale,
      rotation_degrees: item.rotation_degrees,
      layer_order: item.layer_order,
      updated_at: new Date().toISOString(),
    };
    return dataOrThrow(
      await client
        .from("wardrobe_items")
        .update(payload)
        .eq("id", item.id)
        .select()
        .single(),
    );
  }

  async function archiveItem(itemId) {
    return dataOrThrow(
      await client.rpc("archive_wardrobe_item", { p_item_id: itemId }),
    );
  }

  async function restoreItem(itemId) {
    return dataOrThrow(
      await client.rpc("restore_wardrobe_item", { p_item_id: itemId }),
    );
  }

  async function listOutfits() {
    const outfits = dataOrThrow(
      await client
        .from("outfits")
        .select(OUTFIT_SELECT)
        .order("updated_at", { ascending: false }),
    ) || [];
    return signOutfits(outfits);
  }

  async function fetchOutfit(outfitId) {
    const outfit = dataOrThrow(
      await client
        .from("outfits")
        .select(OUTFIT_SELECT)
        .eq("id", outfitId)
        .single(),
    );
    return (await signOutfits([outfit]))[0];
  }

  async function removeAssets(paths) {
    if (!paths.length) return null;
    try {
      const result = await client.storage.from("wardrobe-assets").remove(paths);
      return result?.error ?? null;
    } catch (error) {
      return error;
    }
  }

  async function saveOutfit({ id, name, items, thumbnailBlob }) {
    const authResult = await client.auth.getUser();
    if (authResult.error) throw authResult.error;
    const ownerId = authResult.data?.user?.id;
    if (!ownerId) throw new Error("Authentication is required.");

    const outfitId = id ?? crypto.randomUUID();
    let previousThumbnailPath = null;
    if (id) {
      const previousResult = await client
        .from("outfits")
        .select("thumbnail_path")
        .eq("id", outfitId)
        .maybeSingle();
      if (previousResult.error) throw previousResult.error;
      previousThumbnailPath = previousResult.data?.thumbnail_path ?? null;
    }

    const thumbnailVersionId = crypto.randomUUID();
    const thumbnailPath = `${ownerId}/outfits/${outfitId}/thumbnail-${thumbnailVersionId}.webp`;
    dataOrThrow(await client.storage.from("wardrobe-assets").upload(
      thumbnailPath,
      thumbnailBlob,
      { contentType: "image/webp", upsert: false },
    ));

    const rpcResult = await client.rpc("save_outfit", {
      p_outfit_id: outfitId,
      p_name: name.trim(),
      p_item_ids: items.map((item) => item.id),
      p_thumbnail_path: thumbnailPath,
    });
    if (rpcResult.error) {
      const rollbackCleanupError = await removeAssets([thumbnailPath]);
      const error = new Error(
        rollbackCleanupError
          ? `The outfit could not be saved and its thumbnail remains at ${thumbnailPath}.`
          : "The outfit could not be saved.",
        { cause: rpcResult.error },
      );
      if (rollbackCleanupError) {
        error.recoverable = true;
        error.uploadedPath = thumbnailPath;
        error.cleanupWarning = rollbackCleanupError.message || "Thumbnail cleanup failed.";
      }
      throw error;
    }

    const obsoleteThumbnailPath = previousThumbnailPath !== thumbnailPath
      ? previousThumbnailPath
      : null;
    const cleanupError = obsoleteThumbnailPath
      ? await removeAssets([obsoleteThumbnailPath])
      : null;
    const cleanupWarning = cleanupError
      ? "The old thumbnail could not be removed and will need cleanup."
      : "";

    try {
      const savedOutfit = await fetchOutfit(outfitId);
      return cleanupWarning ? { ...savedOutfit, cleanupWarning } : savedOutfit;
    } catch {
      return {
        id: outfitId,
        name: name.trim(),
        items,
        thumbnail_path: thumbnailPath,
        thumbnailUrl: null,
        needs_attention: false,
        committed: true,
        refreshWarning: "The outfit was saved, but its refreshed preview could not be loaded.",
        ...(cleanupWarning ? { cleanupWarning } : {}),
      };
    }
  }

  async function recordWear({ itemIds, wornAt, outfitId = null, notes = null }) {
    const retryContext = {
      itemIds: [...itemIds],
      wornAt,
      outfitId,
      notes,
    };
    let result;
    try {
      result = await client.rpc("record_wear", {
        p_item_ids: retryContext.itemIds,
        p_worn_at: retryContext.wornAt,
        p_outfit_id: retryContext.outfitId,
        p_notes: retryContext.notes,
      });
    } catch (cause) {
      const error = new Error(cause.message || "The wear event could not be saved.", { cause });
      error.retryContext = retryContext;
      throw error;
    }
    if (result.error) {
      const error = new Error(result.error.message || "The wear event could not be saved.", {
        cause: result.error,
      });
      error.retryContext = retryContext;
      throw error;
    }
    return result.data;
  }

  async function listWearHistory() {
    const events = dataOrThrow(
      await client
        .from("wear_events")
        .select(WEAR_HISTORY_SELECT)
        .order("worn_at", { ascending: false }),
    ) || [];

    return events.map((event) => ({
      ...event,
      items: (event.wear_event_items || [])
        .map((row) => row.wardrobe_item && ({
          ...row.wardrobe_item,
          wardrobe_item_id: row.wardrobe_item_id,
        }))
        .filter(Boolean),
    }));
  }

  async function listItemsWithLastWorn() {
    const [items, lastWornRows] = await Promise.all([
      listItems(),
      dataOrThrow(
        await client
          .from("wardrobe_item_last_worn")
          .select("wardrobe_item_id, last_worn_at"),
      ) || [],
    ]);
    const lastWornByItem = new Map(
      lastWornRows.map((row) => [row.wardrobe_item_id, row.last_worn_at]),
    );
    return items.map((item) => ({
      ...item,
      last_worn_at: lastWornByItem.get(item.id) ?? null,
    }));
  }

  return {
    listItems,
    updateItem,
    archiveItem,
    restoreItem,
    listOutfits,
    saveOutfit,
    listWearHistory,
    listItemsWithLastWorn,
    recordWear,
    createSignedAssetUrls,
  };
}
