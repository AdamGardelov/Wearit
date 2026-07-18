import { slotForCategory } from "../domain/slots.js";

const OUTFIT_SELECT = "*, outfit_items(*, wardrobe_item:wardrobe_items(*))";
const WEAR_HISTORY_SELECT =
  "*, outfit:outfits(id, name), wear_event_items(*, wardrobe_item:wardrobe_items(id, name, status))";

function dataOrThrow(result) {
  if (result.error) throw result.error;
  return result.data;
}

// Normalize a composition's effective layers into unique, in-range integers aligned
// with the item order the RPC expects. Relative order (back-to-front) is preserved so
// loading an outfit reproduces the exact saved stack.
function compositionLayerOrders(items) {
  const ranked = items
    .map((item, index) => ({
      index,
      layer: Number.isFinite(item.layer_order) ? item.layer_order : Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) => left.layer - right.layer || left.index - right.index);
  const layerOrders = new Array(items.length);
  ranked.forEach((entry, rank) => {
    layerOrders[entry.index] = (rank + 1) * 10;
  });
  return layerOrders;
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
  async function authenticatedOwnerId() {
    const result = await client.auth.getUser();
    if (result.error) throw result.error;
    const ownerId = result.data?.user?.id;
    if (!ownerId) throw new Error("Authentication is required.");
    return ownerId;
  }

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
      p_layer_orders: compositionLayerOrders(items),
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

  async function importWardrobeItem({ manifestItem, cutoutFile, detailFiles, placement }) {
    const stages = { cutout: false, details: false, database: false, all: false };
    try {
      const ownerId = await authenticatedOwnerId();
      if (detailFiles.length !== manifestItem.detailFiles.length) {
        throw new Error("Every reviewed detail derivative must have a matching file.");
      }
      const cutoutPath = `${ownerId}/items/${manifestItem.id}/cutout.png`;
      const detailPaths = manifestItem.detailFiles.map((sourcePath) => {
        const assetName = sourcePath.split("/").at(-1);
        return `${ownerId}/items/${manifestItem.id}/details/${assetName}`;
      });
      const existingQuery = client
        .from("wardrobe_items")
        .select("id")
        .eq("id", manifestItem.id)
        .eq("owner_id", ownerId);
      const existingResult = await existingQuery.maybeSingle();
      if (existingResult.error) throw existingResult.error;
      const alreadyImported = Boolean(existingResult.data);

      const storage = client.storage.from("wardrobe-assets");
      dataOrThrow(await storage.upload(cutoutPath, cutoutFile, {
        contentType: cutoutFile.type || "image/png",
        upsert: true,
      }));
      stages.cutout = true;

      for (let index = 0; index < detailFiles.length; index += 1) {
        const detailFile = detailFiles[index];
        dataOrThrow(await storage.upload(detailPaths[index], detailFile, {
          contentType: detailFile.type || "application/octet-stream",
          upsert: true,
        }));
      }
      stages.details = true;

      const savedItemId = dataOrThrow(await client.rpc("import_wardrobe_item", {
        p_item_id: manifestItem.id,
        p_name: manifestItem.name,
        p_category: manifestItem.category,
        p_slot: manifestItem.slot,
        p_colors: manifestItem.colors,
        p_tags: manifestItem.tags,
        p_cutout_path: cutoutPath,
        p_detail_image_paths: detailPaths,
        p_anchor_x: placement.anchorX,
        p_anchor_y: placement.anchorY,
        p_scale: placement.scale,
        p_rotation_degrees: placement.rotationDegrees,
        p_layer_order: placement.layerOrder,
      }));
      stages.database = true;

      const signedAssets = await createSignedAssetUrls([cutoutPath, ...detailPaths]);
      const signedUrlByPath = new Map(
        signedAssets.map((asset) => [asset.path, asset.signedUrl]),
      );
      stages.all = true;
      return {
        item: { id: savedItemId },
        alreadyImported,
        cutoutUrl: signedUrlByPath.get(cutoutPath) ?? null,
        detailUrls: detailPaths.map((path) => signedUrlByPath.get(path) ?? null),
        stages,
      };
    } catch (cause) {
      const error = new Error(cause.message || "The wardrobe item could not be imported.", { cause });
      error.stages = { ...stages };
      throw error;
    }
  }

  async function listStorageFiles(storage, prefix) {
    const paths = [];
    let offset = 0;
    while (true) {
      const entries = dataOrThrow(await storage.list(prefix, {
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      })) || [];
      for (const entry of entries) {
        const path = `${prefix}/${entry.name}`;
        if (entry.id) paths.push(path);
        else paths.push(...await listStorageFiles(storage, path));
      }
      if (entries.length < 1000) break;
      offset += entries.length;
    }
    return paths;
  }

  async function reconcileWardrobeAssets() {
    const ownerId = await authenticatedOwnerId();
    const rows = dataOrThrow(
      await client
        .from("wardrobe_items")
        .select("id, cutout_path, detail_image_paths")
        .eq("owner_id", ownerId),
    ) || [];
    const storagePaths = new Set(
      await listStorageFiles(client.storage.from("wardrobe-assets"), `${ownerId}/items`),
    );
    const databasePaths = new Set(rows.flatMap((row) => [
      row.cutout_path,
      ...(row.detail_image_paths || []),
    ]));
    return {
      orphanedStoragePaths: [...storagePaths]
        .filter((path) => !databasePaths.has(path))
        .sort(),
      missingStorageItemIds: rows
        .filter((row) => [row.cutout_path, ...(row.detail_image_paths || [])]
          .some((path) => !storagePaths.has(path)))
        .map((row) => row.id)
        .sort(),
    };
  }

  async function removeOrphanedWardrobeAssets(paths) {
    const ownerId = await authenticatedOwnerId();
    if (paths.some((path) => !path.startsWith(`${ownerId}/items/`))) {
      throw new Error("Cleanup paths must belong to the current owner.");
    }
    if (!paths.length) return [];
    const uniquePaths = [...new Set(paths)];
    const currentOrphans = new Set(
      (await reconcileWardrobeAssets()).orphanedStoragePaths,
    );
    if (uniquePaths.some((path) => !currentOrphans.has(path))) {
      throw new Error("A selected path is no longer orphaned. Check storage again.");
    }
    return dataOrThrow(
      await client.storage.from("wardrobe-assets").remove(uniquePaths),
    ) || [];
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
    importWardrobeItem,
    reconcileWardrobeAssets,
    removeOrphanedWardrobeAssets,
  };
}
