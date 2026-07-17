import { slotForCategory } from "../domain/slots.js";

function dataOrThrow(result) {
  if (result.error) throw result.error;
  return result.data;
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
      await client
        .from("wardrobe_items")
        .update({ status: "archived", archived_at: new Date().toISOString() })
        .eq("id", itemId)
        .select()
        .single(),
    );
  }

  async function restoreItem(itemId) {
    return dataOrThrow(
      await client
        .from("wardrobe_items")
        .update({ status: "active", archived_at: null })
        .eq("id", itemId)
        .select()
        .single(),
    );
  }

  return {
    listItems,
    updateItem,
    archiveItem,
    restoreItem,
    createSignedAssetUrls,
  };
}
