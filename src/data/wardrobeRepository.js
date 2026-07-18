import { slotForCategory } from "../domain/slots.js";

const OUTFIT_SELECT = "*, outfit_items(*, wardrobe_item:wardrobe_items(*)), outfit_labels(label_id)";
const WEAR_HISTORY_SELECT =
  "*, outfit:outfits(id, name), wear_event_items(*, wardrobe_item:wardrobe_items(id, name, status))";
const LABEL_SELECT = "id, kind, season_key, name, locked";

function dataOrThrow(result) {
  if (result.error) throw result.error;
  return result.data;
}

function assignmentIds(rows = []) {
  return rows.map((row) => row.label_id);
}

function mapLabel(row) {
  return {
    id: row.id,
    kind: row.kind,
    seasonKey: row.season_key,
    name: row.name,
    locked: row.locked,
  };
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

// Structured product images live in a table added after the original schema. A
// database that predates the migration simply has no rows and every item falls
// back to its mannequin cutout, so a missing relation is not a hard failure.
function isMissingRelationError(error) {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const text = String(error.message || "").toLowerCase();
  return (
    text.includes("wardrobe_item_images")
    && (text.includes("does not exist") || text.includes("could not find"))
  );
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

    return outfits.map((outfit) => {
      const { outfit_labels, ...rest } = outfit;
      return {
        ...rest,
        thumbnailUrl: rest.thumbnail_path
          ? signedUrlByPath.get(rest.thumbnail_path) ?? null
          : null,
        items: orderedOutfitItems(rest.outfit_items),
        labelIds: assignmentIds(outfit_labels),
      };
    });
  }

  async function fetchItemImages(itemIds) {
    const imagesByItem = new Map();
    if (!itemIds.length) return imagesByItem;

    let result;
    try {
      result = await client
        .from("wardrobe_item_images")
        .select("id, wardrobe_item_id, storage_path, view, sort_order, is_primary")
        .in("wardrobe_item_id", itemIds);
    } catch (error) {
      if (isMissingRelationError(error)) return imagesByItem;
      throw error;
    }
    if (result.error) {
      if (isMissingRelationError(result.error)) return imagesByItem;
      throw result.error;
    }

    for (const row of result.data || []) {
      const rows = imagesByItem.get(row.wardrobe_item_id) || [];
      rows.push(row);
      imagesByItem.set(row.wardrobe_item_id, rows);
    }
    for (const rows of imagesByItem.values()) {
      rows.sort((left, right) => (
        (left.sort_order ?? 0) - (right.sort_order ?? 0)
        || String(left.id).localeCompare(String(right.id))
      ));
    }
    return imagesByItem;
  }

  async function listItems({ includeArchived = false } = {}) {
    let query = client
      .from("wardrobe_items")
      .select("*, wardrobe_item_labels(label_id)")
      .order("created_at", { ascending: false });

    if (!includeArchived) query = query.eq("status", "active");

    const items = dataOrThrow(await query) || [];
    if (!items.length) return [];

    const imagesByItem = await fetchItemImages(items.map((item) => item.id));
    const imagePaths = items.flatMap((item) => (
      (imagesByItem.get(item.id) || []).map((image) => image.storage_path)
    ));
    const signedAssets = await createSignedAssetUrls([
      ...items.map((item) => item.cutout_path),
      ...imagePaths,
    ]);
    const signedUrlByPath = new Map(
      signedAssets.map((asset) => [asset.path, asset.signedUrl]),
    );

    return items.map((item) => {
      const { wardrobe_item_labels, ...itemFields } = item;
      const cutoutUrl = signedUrlByPath.get(item.cutout_path) ?? null;
      const images = (imagesByItem.get(item.id) || []).map((image) => ({
        id: image.id,
        view: image.view,
        sortOrder: image.sort_order,
        isPrimary: image.is_primary,
        url: signedUrlByPath.get(image.storage_path) ?? null,
      }));
      const primary = images.find((image) => image.isPrimary) ?? images[0] ?? null;
      return {
        ...itemFields,
        cutoutUrl,
        images,
        primaryImageUrl: primary?.url ?? cutoutUrl,
        labelIds: assignmentIds(wardrobe_item_labels),
      };
    });
  }

  async function updateItem(item) {
    const slot = slotForCategory(item.category);
    if (!slot) throw new Error(`Category ${item.category} has no wardrobe slot.`);

    const labelIds = item.labelIds ?? [];
    dataOrThrow(await client.rpc("update_wardrobe_item_with_labels", {
      p_item_id: item.id,
      p_name: item.name,
      p_category: item.category,
      p_slot: slot,
      p_brand: item.brand,
      p_size: item.size,
      p_notes: item.notes,
      p_colors: item.colors,
      p_tags: item.tags,
      p_anchor_x: item.anchor_x,
      p_anchor_y: item.anchor_y,
      p_scale: item.scale,
      p_rotation_degrees: item.rotation_degrees,
      p_layer_order: item.layer_order,
      p_label_ids: labelIds,
    }));
    // Return the original item with normalized editable fields so App can update its
    // cache without re-signing assets. The RPC replaced the assignment set to labelIds.
    return {
      ...item,
      slot,
      labelIds,
    };
  }

  async function listLabels() {
    const labels = dataOrThrow(
      await client
        .from("wardrobe_labels")
        .select(LABEL_SELECT)
        .order("kind", { ascending: true })
        .order("season_key", { ascending: true, nullsFirst: false })
        .order("name", { ascending: true }),
    ) || [];
    return labels.map(mapLabel);
  }

  async function createTheme(name) {
    const ownerId = await authenticatedOwnerId();
    return mapLabel(dataOrThrow(
      await client
        .from("wardrobe_labels")
        .insert({ owner_id: ownerId, kind: "theme", season_key: null, locked: false, name: name.trim() })
        .select(LABEL_SELECT)
        .single(),
    ));
  }

  async function renameTheme(labelId, name) {
    return mapLabel(dataOrThrow(
      await client
        .from("wardrobe_labels")
        .update({ name: name.trim(), updated_at: new Date().toISOString() })
        .eq("id", labelId)
        .eq("kind", "theme")
        .eq("locked", false)
        .select(LABEL_SELECT)
        .single(),
    ));
  }

  async function deleteTheme(labelId) {
    return dataOrThrow(
      await client
        .from("wardrobe_labels")
        .delete()
        .eq("id", labelId)
        .eq("kind", "theme")
        .eq("locked", false),
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

  // Outfit last-worn is optional metadata. A failed lookup must not empty the Outfits list or
  // the planner picker, so it degrades to "unavailable" and callers fall back to Standard order.
  async function outfitLastWorn() {
    try {
      const rows = dataOrThrow(
        await client.from("outfit_last_worn").select("outfit_id, last_worn_at"),
      ) || [];
      return {
        byOutfit: new Map(rows.map((row) => [row.outfit_id, row.last_worn_at])),
        unavailable: false,
      };
    } catch {
      return { byOutfit: new Map(), unavailable: true };
    }
  }

  async function listOutfits() {
    const [outfits, lastWorn] = await Promise.all([
      dataOrThrow(
        await client
          .from("outfits")
          .select(OUTFIT_SELECT)
          .order("updated_at", { ascending: false }),
      ) || [],
      outfitLastWorn(),
    ]);
    return signOutfits(outfits.map((outfit) => ({
      ...outfit,
      last_worn_at: lastWorn.byOutfit.get(outfit.id) ?? null,
      ...(lastWorn.unavailable ? { last_worn_unavailable: true } : {}),
    })));
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

  async function saveOutfit({ id, name, items, thumbnailBlob, labelIds = [] }) {
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

    const rpcResult = await client.rpc("save_outfit_with_labels", {
      p_outfit_id: outfitId,
      p_name: name.trim(),
      p_item_ids: items.map((item) => item.id),
      p_layer_orders: compositionLayerOrders(items),
      p_thumbnail_path: thumbnailPath,
      p_label_ids: labelIds,
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
        labelIds,
        thumbnail_path: thumbnailPath,
        thumbnailUrl: null,
        needs_attention: false,
        committed: true,
        refreshWarning: "The outfit was saved, but its refreshed preview could not be loaded.",
        ...(cleanupWarning ? { cleanupWarning } : {}),
      };
    }
  }

  async function deleteOutfit(outfitId) {
    const result = await client.rpc("delete_outfit", { p_outfit_id: outfitId });
    if (result.error) throw result.error;
    // The RPC returns the outfit's thumbnail path (or null); best-effort remove the asset.
    const thumbnailPath = result.data ?? null;
    const cleanupError = thumbnailPath ? await removeAssets([thumbnailPath]) : null;
    return {
      id: outfitId,
      ...(cleanupError
        ? { cleanupWarning: "The outfit was removed, but its thumbnail could not be cleaned up." }
        : {}),
    };
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

  // Item last-worn is optional metadata. A failed lookup must not empty Wardrobe, so it degrades
  // to "unavailable" and the view falls back to Standard order.
  async function itemLastWorn() {
    try {
      const rows = dataOrThrow(
        await client
          .from("wardrobe_item_last_worn")
          .select("wardrobe_item_id, last_worn_at"),
      ) || [];
      return {
        byItem: new Map(rows.map((row) => [row.wardrobe_item_id, row.last_worn_at])),
        unavailable: false,
      };
    } catch {
      return { byItem: new Map(), unavailable: true };
    }
  }

  async function listItemsWithLastWorn() {
    const [items, lastWorn] = await Promise.all([
      listItems(),
      itemLastWorn(),
    ]);
    return items.map((item) => ({
      ...item,
      last_worn_at: lastWorn.byItem.get(item.id) ?? null,
      ...(lastWorn.unavailable ? { last_worn_unavailable: true } : {}),
    }));
  }

  function requireWeekday(weekday) {
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 5) {
      throw new Error("Weekday must be an integer from 1 to 5.");
    }
  }

  async function listWeeklyPlan() {
    const [rows, outfits] = await Promise.all([
      dataOrThrow(
        await client
          .from("weekly_plan_slots")
          .select("weekday, outfit_id")
          .order("weekday", { ascending: true }),
      ) || [],
      listOutfits(),
    ]);
    const rowByDay = new Map(rows.map((row) => [row.weekday, row]));
    const outfitById = new Map(outfits.map((outfit) => [outfit.id, outfit]));
    return [1, 2, 3, 4, 5].map((weekday) => {
      const row = rowByDay.get(weekday);
      const outfit = row ? outfitById.get(row.outfit_id) ?? null : null;
      return { weekday, outfitId: outfit?.id ?? null, outfit };
    });
  }

  // Writes go through a security-definer RPC (like every other write in the app). A direct
  // upsert would need UPDATE on owner_id/weekday, which the planner keeps immutable.
  async function setWeeklyPlanSlot({ weekday, outfitId }) {
    requireWeekday(weekday);
    return dataOrThrow(await client.rpc("set_weekly_plan_slot", {
      p_weekday: weekday,
      p_outfit_id: outfitId,
    }));
  }

  async function clearWeeklyPlanSlot(weekday) {
    requireWeekday(weekday);
    const ownerId = await authenticatedOwnerId();
    return dataOrThrow(await client
      .from("weekly_plan_slots")
      .delete()
      .eq("owner_id", ownerId)
      .eq("weekday", weekday));
  }

  async function clearWeeklyPlan() {
    const ownerId = await authenticatedOwnerId();
    return dataOrThrow(await client
      .from("weekly_plan_slots")
      .delete()
      .eq("owner_id", ownerId));
  }

  async function importWardrobeItem(request) {
    if (Array.isArray(request?.manifestItem?.images)) {
      return importWardrobeItemV2(request);
    }
    return importWardrobeItemV1(request);
  }

  async function importWardrobeItemV2({ manifestItem, cutoutFile, imageFiles, placement }) {
    const stages = { wearLayer: false, images: false, database: false, all: false };
    const uploadedPaths = [];
    try {
      const ownerId = await authenticatedOwnerId();
      if (!Array.isArray(imageFiles) || imageFiles.length !== manifestItem.images.length) {
        throw new Error("Every reviewed product image must have a matching file.");
      }

      const version = crypto.randomUUID();
      const wearLayerPath = `${ownerId}/items/${manifestItem.id}/wear-layer/${version}.png`;
      const images = manifestItem.images.map((image, index) => {
        const file = imageFiles[index]?.file;
        const ext = (file?.name?.split(".").at(-1) || "webp").toLowerCase();
        return {
          id: image.id,
          view: image.view,
          sortOrder: image.sortOrder,
          isPrimary: image.isPrimary,
          file,
          storagePath: `${ownerId}/items/${manifestItem.id}/images/${image.id}-${version}.${ext}`,
        };
      });

      const existingResult = await client
        .from("wardrobe_items")
        .select("id")
        .eq("id", manifestItem.id)
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (existingResult.error) throw existingResult.error;
      const alreadyImported = Boolean(existingResult.data);

      const storage = client.storage.from("wardrobe-assets");
      dataOrThrow(await storage.upload(wearLayerPath, cutoutFile, {
        contentType: cutoutFile.type || "image/png",
        upsert: true,
      }));
      uploadedPaths.push(wearLayerPath);
      stages.wearLayer = true;

      for (const image of images) {
        dataOrThrow(await storage.upload(image.storagePath, image.file, {
          contentType: image.file?.type || "application/octet-stream",
          upsert: true,
        }));
        uploadedPaths.push(image.storagePath);
      }
      stages.images = true;

      const savedItemId = dataOrThrow(await client.rpc("import_wardrobe_item_v2", {
        p_item_id: manifestItem.id,
        p_name: manifestItem.name,
        p_category: manifestItem.category,
        p_slot: manifestItem.slot,
        p_colors: manifestItem.colors,
        p_tags: manifestItem.tags,
        p_wear_layer_path: wearLayerPath,
        p_images: images.map((image) => ({
          id: image.id,
          storage_path: image.storagePath,
          view: image.view,
          sort_order: image.sortOrder,
          is_primary: image.isPrimary,
        })),
        p_anchor_x: placement.anchorX,
        p_anchor_y: placement.anchorY,
        p_scale: placement.scale,
        p_rotation_degrees: placement.rotationDegrees,
        p_layer_order: placement.layerOrder,
      }));
      stages.database = true;

      const signedAssets = await createSignedAssetUrls([
        wearLayerPath,
        ...images.map((image) => image.storagePath),
      ]);
      const signedUrlByPath = new Map(
        signedAssets.map((asset) => [asset.path, asset.signedUrl]),
      );
      const signedImages = images.map((image) => ({
        id: image.id,
        view: image.view,
        sortOrder: image.sortOrder,
        isPrimary: image.isPrimary,
        url: signedUrlByPath.get(image.storagePath) ?? null,
      }));
      const primary = signedImages.find((image) => image.isPrimary) ?? signedImages[0] ?? null;
      stages.all = true;
      return {
        item: { id: savedItemId },
        alreadyImported,
        cutoutUrl: signedUrlByPath.get(wearLayerPath) ?? null,
        images: signedImages,
        primaryImageUrl: primary?.url ?? signedUrlByPath.get(wearLayerPath) ?? null,
        stages,
      };
    } catch (cause) {
      // A committed import owns its objects; only clean up when the database never
      // accepted the upload so a retry starts from a clean slate.
      if (!stages.database && uploadedPaths.length) {
        await removeAssets(uploadedPaths);
      }
      const error = new Error(cause.message || "The wardrobe item could not be imported.", { cause });
      error.stages = { ...stages };
      throw error;
    }
  }

  async function importWardrobeItemV1({ manifestItem, cutoutFile, detailFiles, placement }) {
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

  async function ownerImagePaths(ownerId) {
    let result;
    try {
      result = await client
        .from("wardrobe_item_images")
        .select("storage_path")
        .eq("owner_id", ownerId);
    } catch (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }
    if (result.error) {
      if (isMissingRelationError(result.error)) return [];
      throw result.error;
    }
    return (result.data || []).map((row) => row.storage_path).filter(Boolean);
  }

  async function reconcileWardrobeAssets() {
    const ownerId = await authenticatedOwnerId();
    const rows = dataOrThrow(
      await client
        .from("wardrobe_items")
        .select("id, cutout_path, detail_image_paths")
        .eq("owner_id", ownerId),
    ) || [];
    const imagePaths = await ownerImagePaths(ownerId);
    const storagePaths = new Set(
      await listStorageFiles(client.storage.from("wardrobe-assets"), `${ownerId}/items`),
    );
    const databasePaths = new Set([
      ...rows.flatMap((row) => [
        row.cutout_path,
        ...(row.detail_image_paths || []),
      ]),
      ...imagePaths,
    ]);
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
    deleteOutfit,
    listLabels,
    createTheme,
    renameTheme,
    deleteTheme,
    listWearHistory,
    listItemsWithLastWorn,
    recordWear,
    listWeeklyPlan,
    setWeeklyPlanSlot,
    clearWeeklyPlanSlot,
    clearWeeklyPlan,
    createSignedAssetUrls,
    importWardrobeItem,
    reconcileWardrobeAssets,
    removeOrphanedWardrobeAssets,
  };
}
