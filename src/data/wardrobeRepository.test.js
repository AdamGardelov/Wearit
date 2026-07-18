import { afterEach, describe, expect, it, vi } from "vitest";
import { createWardrobeRepository } from "./wardrobeRepository.js";

const NOW = "2026-07-17T10:00:00.000Z";

function createQuery(result) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    update: vi.fn(() => query),
    single: vi.fn(() => Promise.resolve(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

function createImagesQuery(imagesResult = { data: [], error: null }) {
  const query = {
    select: vi.fn(() => query),
    in: vi.fn(() => Promise.resolve(imagesResult)),
  };
  return query;
}

function createClient(
  query,
  signedResult = { data: [], error: null },
  imagesResult = { data: [], error: null },
) {
  const createSignedUrls = vi.fn().mockResolvedValue(signedResult);
  const imagesQuery = createImagesQuery(imagesResult);
  return {
    client: {
      from: vi.fn((table) => (table === "wardrobe_item_images" ? imagesQuery : query)),
      storage: { from: vi.fn(() => ({ createSignedUrls })) },
    },
    createSignedUrls,
    imagesQuery,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createWardrobeRepository", () => {
  it("imports reviewed assets under the authenticated owner and reports completed stages", async () => {
    const ownerId = "owner-1";
    const itemId = "96541a13-deb2-51da-bc91-8d0505624551";
    const cutoutFile = new File(["cutout"], "cutout.png", { type: "image/png" });
    const detailFile = new File(["detail"], "label.webp", { type: "image/webp" });
    const existingQuery = {
      select: vi.fn(() => existingQuery),
      eq: vi.fn(() => existingQuery),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const from = vi.fn(() => existingQuery);
    const upload = vi.fn().mockResolvedValue({ data: {}, error: null });
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [
        { path: `${ownerId}/items/${itemId}/cutout.png`, signedUrl: "https://signed.test/cutout" },
        { path: `${ownerId}/items/${itemId}/details/label.webp`, signedUrl: "https://signed.test/label" },
      ],
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({ data: itemId, error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: ownerId } }, error: null }) },
      from,
      rpc,
      storage: { from: vi.fn(() => ({ upload, createSignedUrls })) },
    };

    const result = await createWardrobeRepository(client).importWardrobeItem({
      manifestItem: {
        id: itemId,
        name: "Navy cardigan",
        category: "jacket",
        slot: "outerwear",
        colors: ["#172033"],
        tags: ["knit"],
        detailFiles: [`assets/${itemId}/details/label.webp`],
      },
      cutoutFile,
      detailFiles: [detailFile],
      placement: { anchorX: 0.51, anchorY: 0.39, scale: 0.7, rotationDegrees: -2, layerOrder: 41 },
    });

    expect(upload).toHaveBeenNthCalledWith(1, `${ownerId}/items/${itemId}/cutout.png`, cutoutFile, {
      contentType: "image/png",
      upsert: true,
    });
    expect(upload).toHaveBeenNthCalledWith(2, `${ownerId}/items/${itemId}/details/label.webp`, detailFile, {
      contentType: "image/webp",
      upsert: true,
    });
    expect(rpc).toHaveBeenCalledWith("import_wardrobe_item", expect.objectContaining({
      p_item_id: itemId,
      p_cutout_path: `${ownerId}/items/${itemId}/cutout.png`,
      p_detail_image_paths: [`${ownerId}/items/${itemId}/details/label.webp`],
      p_anchor_x: 0.51,
      p_anchor_y: 0.39,
      p_scale: 0.7,
      p_rotation_degrees: -2,
      p_layer_order: 41,
    }));
    expect(result).toMatchObject({
      alreadyImported: false,
      cutoutUrl: "https://signed.test/cutout",
      detailUrls: ["https://signed.test/label"],
      stages: { cutout: true, details: true, database: true, all: true },
    });
  });

  it("keeps failed imports retryable with exact stage information", async () => {
    const detailError = new Error("detail upload failed");
    const upload = vi.fn()
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: null, error: detailError });
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null }) },
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({ upload })) },
    };

    const error = await createWardrobeRepository(client).importWardrobeItem({
      manifestItem: {
        id: "item-1", name: "Top", category: "top", slot: "top", colors: [], tags: [],
        detailFiles: ["assets/item-1/details/label.webp"],
      },
      cutoutFile: new File(["x"], "cutout.png", { type: "image/png" }),
      detailFiles: [new File(["x"], "label.webp", { type: "image/webp" })],
      placement: { anchorX: 0.5, anchorY: 0.5, scale: 0.5, rotationDegrees: 0, layerOrder: 30 },
    }).catch((reason) => reason);

    expect(error).toMatchObject({
      cause: detailError,
      stages: { cutout: true, details: false, database: false, all: false },
    });
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("persists reviewed metadata through the import RPC when the stable ID already exists", async () => {
    const ownerId = "owner-1";
    const itemId = "96541a13-deb2-51da-bc91-8d0505624551";
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: itemId }, error: null }),
    };
    const upload = vi.fn().mockResolvedValue({ data: {}, error: null });
    const createSignedUrls = vi.fn().mockResolvedValue({ data: [], error: null });
    const rpc = vi.fn().mockResolvedValue({ data: itemId, error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: ownerId } }, error: null }) },
      from: vi.fn(() => query),
      rpc,
      storage: { from: vi.fn(() => ({ upload, createSignedUrls })) },
    };

    const result = await createWardrobeRepository(client).importWardrobeItem({
      manifestItem: {
        id: itemId,
        name: "Updated cardigan",
        category: "coat",
        slot: "outerwear",
        colors: ["#101820"],
        tags: ["smart"],
        detailFiles: [`assets/${itemId}/details/new-label.jpg`],
      },
      cutoutFile: new File(["cutout"], "cutout.png", { type: "image/png" }),
      detailFiles: [new File(["detail"], "new-label.jpg", { type: "image/jpeg" })],
      placement: { anchorX: 0.52, anchorY: 0.4, scale: 0.7, rotationDegrees: -2, layerOrder: 44 },
    });

    expect(rpc).toHaveBeenCalledWith("import_wardrobe_item", {
      p_item_id: itemId,
      p_name: "Updated cardigan",
      p_category: "coat",
      p_slot: "outerwear",
      p_colors: ["#101820"],
      p_tags: ["smart"],
      p_cutout_path: `${ownerId}/items/${itemId}/cutout.png`,
      p_detail_image_paths: [`${ownerId}/items/${itemId}/details/new-label.jpg`],
      p_anchor_x: 0.52,
      p_anchor_y: 0.4,
      p_scale: 0.7,
      p_rotation_degrees: -2,
      p_layer_order: 44,
    });
    expect(result).toMatchObject({ alreadyImported: true, stages: { database: true, all: true } });
  });

  it("imports a v2 item with a versioned wear layer and structured product images", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "ver-1") });
    const ownerId = "owner-1";
    const itemId = "96541a13-deb2-51da-bc91-8d0505624551";
    const frontId = "11111111-1111-4111-8111-111111111111";
    const wearPath = `${ownerId}/items/${itemId}/wear-layer/ver-1.png`;
    const frontPath = `${ownerId}/items/${itemId}/images/${frontId}-ver-1.webp`;
    const existing = {
      select: vi.fn(() => existing),
      eq: vi.fn(() => existing),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const upload = vi.fn().mockResolvedValue({ data: {}, error: null });
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [
        { path: wearPath, signedUrl: "https://signed.test/layer" },
        { path: frontPath, signedUrl: "https://signed.test/front" },
      ],
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({ data: itemId, error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: ownerId } }, error: null }) },
      from: vi.fn(() => existing),
      rpc,
      storage: { from: vi.fn(() => ({ upload, createSignedUrls })) },
    };

    const result = await createWardrobeRepository(client).importWardrobeItem({
      manifestItem: {
        version: 2,
        id: itemId,
        name: "Disco tee",
        category: "top",
        slot: "top",
        colors: ["#202020"],
        tags: ["tshirt"],
        images: [{ id: frontId, view: "front", sortOrder: 0, isPrimary: true }],
      },
      cutoutFile: new File(["layer"], "wear-layer.png", { type: "image/png" }),
      imageFiles: [{
        id: frontId,
        view: "front",
        sortOrder: 0,
        isPrimary: true,
        file: new File(["front"], "front.webp", { type: "image/webp" }),
      }],
      placement: { anchorX: 0.5, anchorY: 0.34, scale: 0.6, rotationDegrees: 0, layerOrder: 30 },
    });

    expect(upload).toHaveBeenNthCalledWith(1, wearPath, expect.any(File), {
      contentType: "image/png",
      upsert: true,
    });
    expect(upload).toHaveBeenNthCalledWith(2, frontPath, expect.any(File), {
      contentType: "image/webp",
      upsert: true,
    });
    expect(rpc).toHaveBeenCalledWith("import_wardrobe_item_v2", expect.objectContaining({
      p_item_id: itemId,
      p_wear_layer_path: wearPath,
      p_images: [{
        id: frontId,
        storage_path: frontPath,
        view: "front",
        sort_order: 0,
        is_primary: true,
      }],
      p_layer_order: 30,
    }));
    expect(result).toMatchObject({
      alreadyImported: false,
      cutoutUrl: "https://signed.test/layer",
      primaryImageUrl: "https://signed.test/front",
      stages: { wearLayer: true, images: true, database: true, all: true },
    });
  });

  it("removes prior v2 image versions only after the replacement RPC commits", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "ver-new") });
    const ownerId = "owner-1";
    const itemId = "96541a13-deb2-51da-bc91-8d0505624551";
    const frontId = "11111111-1111-4111-8111-111111111111";
    const oldWearPath = `${ownerId}/items/${itemId}/wear-layer/ver-old.png`;
    const oldFrontPath = `${ownerId}/items/${itemId}/images/${frontId}-ver-old.webp`;
    const newWearPath = `${ownerId}/items/${itemId}/wear-layer/ver-new.png`;
    const newFrontPath = `${ownerId}/items/${itemId}/images/${frontId}-ver-new.webp`;
    const itemQuery = {
      select: vi.fn(() => itemQuery),
      eq: vi.fn(() => itemQuery),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: itemId, cutout_path: oldWearPath },
        error: null,
      }),
    };
    const imageQuery = {
      select: vi.fn(() => imageQuery),
      eq: vi.fn(() => imageQuery),
      then: (resolve, reject) => Promise.resolve({
        data: [{ storage_path: oldFrontPath }],
        error: null,
      }).then(resolve, reject),
    };
    const upload = vi.fn().mockResolvedValue({ data: {}, error: null });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const createSignedUrls = vi.fn().mockResolvedValue({ data: [], error: null });
    const rpc = vi.fn().mockResolvedValue({ data: itemId, error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: ownerId } }, error: null }) },
      from: vi.fn((table) => table === "wardrobe_items" ? itemQuery : imageQuery),
      rpc,
      storage: { from: vi.fn(() => ({ upload, remove, createSignedUrls })) },
    };

    const result = await createWardrobeRepository(client).importWardrobeItem({
      manifestItem: {
        version: 2, id: itemId, name: "Updated tee", category: "top", slot: "top",
        colors: ["#202020"], tags: ["tshirt"],
        images: [{ id: frontId, view: "front", sortOrder: 0, isPrimary: true }],
      },
      cutoutFile: new File(["layer"], "wear-layer.png", { type: "image/png" }),
      imageFiles: [{
        id: frontId, view: "front", sortOrder: 0, isPrimary: true,
        file: new File(["front"], "front.webp", { type: "image/webp" }),
      }],
      placement: { anchorX: 0.5, anchorY: 0.5, scale: 1, rotationDegrees: 0, layerOrder: 20 },
    });

    expect(remove).toHaveBeenCalledWith([oldWearPath, oldFrontPath]);
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
    expect(result).not.toHaveProperty("cleanupWarning");
    expect(upload).toHaveBeenNthCalledWith(1, newWearPath, expect.any(File), expect.any(Object));
    expect(upload).toHaveBeenNthCalledWith(2, newFrontPath, expect.any(File), expect.any(Object));
  });

  it("keeps prior v2 versions and rolls back new uploads when the RPC fails", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "ver-new") });
    const ownerId = "owner-1";
    const itemId = "96541a13-deb2-51da-bc91-8d0505624551";
    const frontId = "11111111-1111-4111-8111-111111111111";
    const oldWearPath = `${ownerId}/items/${itemId}/wear-layer/ver-old.png`;
    const oldFrontPath = `${ownerId}/items/${itemId}/images/${frontId}-ver-old.webp`;
    const newWearPath = `${ownerId}/items/${itemId}/wear-layer/ver-new.png`;
    const newFrontPath = `${ownerId}/items/${itemId}/images/${frontId}-ver-new.webp`;
    const itemQuery = {
      select: vi.fn(() => itemQuery), eq: vi.fn(() => itemQuery),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: itemId, cutout_path: oldWearPath }, error: null }),
    };
    const imageQuery = {
      select: vi.fn(() => imageQuery), eq: vi.fn(() => imageQuery),
      then: (resolve, reject) => Promise.resolve({ data: [{ storage_path: oldFrontPath }], error: null }).then(resolve, reject),
    };
    const upload = vi.fn().mockResolvedValue({ data: {}, error: null });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const rpcError = new Error("RPC failed");
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: ownerId } }, error: null }) },
      from: vi.fn((table) => table === "wardrobe_items" ? itemQuery : imageQuery),
      rpc: vi.fn().mockResolvedValue({ data: null, error: rpcError }),
      storage: { from: vi.fn(() => ({ upload, remove })) },
    };

    await expect(createWardrobeRepository(client).importWardrobeItem({
      manifestItem: {
        version: 2, id: itemId, name: "Updated tee", category: "top", slot: "top",
        colors: ["#202020"], tags: [],
        images: [{ id: frontId, view: "front", sortOrder: 0, isPrimary: true }],
      },
      cutoutFile: new File(["layer"], "wear-layer.png", { type: "image/png" }),
      imageFiles: [{ id: frontId, file: new File(["front"], "front.webp", { type: "image/webp" }) }],
      placement: { anchorX: 0.5, anchorY: 0.5, scale: 1, rotationDegrees: 0, layerOrder: 20 },
    })).rejects.toMatchObject({ cause: rpcError });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([newWearPath, newFrontPath]);
    expect(remove).not.toHaveBeenCalledWith(expect.arrayContaining([oldWearPath, oldFrontPath]));
  });

  it("keeps a committed v2 replacement when obsolete-image cleanup fails", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "ver-new") });
    const ownerId = "owner-1";
    const itemId = "96541a13-deb2-51da-bc91-8d0505624551";
    const frontId = "11111111-1111-4111-8111-111111111111";
    const itemQuery = {
      select: vi.fn(() => itemQuery), eq: vi.fn(() => itemQuery),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: itemId, cutout_path: `${ownerId}/items/${itemId}/wear-layer/ver-old.png` },
        error: null,
      }),
    };
    const imageQuery = {
      select: vi.fn(() => imageQuery), eq: vi.fn(() => imageQuery),
      then: (resolve, reject) => Promise.resolve({
        data: [{ storage_path: `${ownerId}/items/${itemId}/images/${frontId}-ver-old.webp` }],
        error: null,
      }).then(resolve, reject),
    };
    const cleanupError = new Error("Storage unavailable");
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: ownerId } }, error: null }) },
      from: vi.fn((table) => table === "wardrobe_items" ? itemQuery : imageQuery),
      rpc: vi.fn().mockResolvedValue({ data: itemId, error: null }),
      storage: { from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
        remove: vi.fn().mockResolvedValue({ data: null, error: cleanupError }),
        createSignedUrls: vi.fn().mockResolvedValue({ data: [], error: null }),
      })) },
    };

    const result = await createWardrobeRepository(client).importWardrobeItem({
      manifestItem: {
        version: 2, id: itemId, name: "Updated tee", category: "top", slot: "top",
        colors: ["#202020"], tags: [],
        images: [{ id: frontId, view: "front", sortOrder: 0, isPrimary: true }],
      },
      cutoutFile: new File(["layer"], "wear-layer.png", { type: "image/png" }),
      imageFiles: [{ id: frontId, file: new File(["front"], "front.webp", { type: "image/webp" }) }],
      placement: { anchorX: 0.5, anchorY: 0.5, scale: 1, rotationDegrees: 0, layerOrder: 20 },
    });

    expect(result).toMatchObject({
      committed: true,
      cleanupWarning: expect.stringMatching(/old.*images/i),
      stages: { database: true, all: true },
    });
  });

  it("returns a committed fallback when v2 asset signing fails after the RPC", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "ver-new") });
    const ownerId = "owner-1";
    const itemId = "96541a13-deb2-51da-bc91-8d0505624551";
    const frontId = "11111111-1111-4111-8111-111111111111";
    const itemQuery = {
      select: vi.fn(() => itemQuery),
      eq: vi.fn(() => itemQuery),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const signingError = new Error("Signing unavailable");
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: ownerId } }, error: null }) },
      from: vi.fn(() => itemQuery),
      rpc: vi.fn().mockResolvedValue({ data: itemId, error: null }),
      storage: { from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
        createSignedUrls: vi.fn().mockResolvedValue({ data: null, error: signingError }),
      })) },
    };

    const result = await createWardrobeRepository(client).importWardrobeItem({
      manifestItem: {
        version: 2, id: itemId, name: "Updated tee", category: "top", slot: "top",
        colors: ["#202020"], tags: [],
        images: [{ id: frontId, view: "front", sortOrder: 0, isPrimary: true }],
      },
      cutoutFile: new File(["layer"], "wear-layer.png", { type: "image/png" }),
      imageFiles: [{ id: frontId, file: new File(["front"], "front.webp", { type: "image/webp" }) }],
      placement: { anchorX: 0.5, anchorY: 0.5, scale: 1, rotationDegrees: 0, layerOrder: 20 },
    });

    expect(result).toMatchObject({
      item: { id: itemId },
      committed: true,
      cutoutUrl: null,
      primaryImageUrl: null,
      refreshWarning: expect.stringMatching(/saved.*preview/i),
      stages: { wearLayer: true, images: true, database: true, all: true },
    });
    expect(result.images).toEqual([expect.objectContaining({ id: frontId, url: null })]);
  });

  it("reconciles owner storage objects against database asset paths", async () => {
    const ownerId = "owner-1";
    const list = vi.fn(async (prefix) => ({
      data: {
        [`${ownerId}/items`]: [{ name: "item-a", id: null }, { name: "orphan.png", id: "object-orphan" }],
        [`${ownerId}/items/item-a`]: [{ name: "cutout.png", id: "object-cutout" }],
      }[prefix] || [],
      error: null,
    }));
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      then: (resolve, reject) => Promise.resolve({
        data: [
          { id: "item-a", cutout_path: `${ownerId}/items/item-a/cutout.png`, detail_image_paths: [] },
          { id: "item-missing", cutout_path: `${ownerId}/items/item-missing/cutout.png`, detail_image_paths: [] },
        ],
        error: null,
      }).then(resolve, reject),
    };
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: ownerId } }, error: null }) },
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({ list })) },
    };

    await expect(createWardrobeRepository(client).reconcileWardrobeAssets()).resolves.toEqual({
      orphanedStoragePaths: [`${ownerId}/items/orphan.png`],
      missingStorageItemIds: ["item-missing"],
    });
    expect(query.eq).toHaveBeenCalledWith("owner_id", ownerId);
    expect(list).toHaveBeenCalledWith(`${ownerId}/items`, expect.any(Object));
  });

  it("revalidates confirmed paths as current import orphans before deleting", async () => {
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
    };
    const list = vi.fn().mockResolvedValue({
      data: [{ name: "orphan.png", id: "object-orphan" }],
      error: null,
    });
    const repository = createWardrobeRepository({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null }) },
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({ list, remove })) },
    });

    await expect(repository.removeOrphanedWardrobeAssets(["owner-2/items/nope.png"]))
      .rejects.toThrow(/current owner/i);
    await repository.removeOrphanedWardrobeAssets(["owner-1/items/orphan.png"]);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(["owner-1/items/orphan.png"]);
  });

  it("refuses cleanup when a previously orphaned path is no longer orphaned", async () => {
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      then: (resolve, reject) => Promise.resolve({
        data: [{ id: "item-1", cutout_path: "owner-1/items/item-1/cutout.png", detail_image_paths: [] }],
        error: null,
      }).then(resolve, reject),
    };
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null }) },
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({
        list: vi.fn().mockResolvedValue({ data: [{ name: "item-1", id: null }], error: null }),
        remove,
      })) },
    };
    client.storage.from = vi.fn(() => ({
      list: vi.fn(async (prefix) => ({
        data: prefix.endsWith("item-1") ? [{ name: "cutout.png", id: "object-1" }] : [{ name: "item-1", id: null }],
        error: null,
      })),
      remove,
    }));

    await expect(createWardrobeRepository(client)
      .removeOrphanedWardrobeAssets(["owner-1/items/item-1/cutout.png"]))
      .rejects.toThrow(/no longer orphaned/i);
    expect(remove).not.toHaveBeenCalled();
  });

  it("records a wear event with every selected item and retry-safe context", async () => {
    const rpcError = new Error("database unavailable");
    const rpc = vi.fn().mockResolvedValue({ data: null, error: rpcError });
    const client = { rpc };
    const request = {
      itemIds: ["item-a", "item-b"],
      wornAt: "2026-07-17T08:00:00.000Z",
      outfitId: "outfit-a",
      notes: null,
    };

    const error = await createWardrobeRepository(client)
      .recordWear(request)
      .catch((reason) => reason);

    expect(rpc).toHaveBeenCalledWith("record_wear", {
      p_item_ids: ["item-a", "item-b"],
      p_worn_at: "2026-07-17T08:00:00.000Z",
      p_outfit_id: "outfit-a",
      p_notes: null,
    });
    expect(error).toMatchObject({ cause: rpcError, retryContext: request });
  });

  it("returns the recorded event id when wear persistence succeeds", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "wear-event-1", error: null });

    await expect(createWardrobeRepository({ rpc }).recordWear({
      itemIds: ["item-a"],
      wornAt: "2026-07-17T10:00:00.000Z",
      outfitId: null,
      notes: "Sunny",
    })).resolves.toBe("wear-event-1");
  });

  it("preserves retry context when the wear request throws before a response", async () => {
    const transportError = new Error("offline");
    const request = {
      itemIds: ["item-a"],
      wornAt: "2026-07-17T10:00:00.000Z",
      outfitId: null,
      notes: null,
    };

    const error = await createWardrobeRepository({
      rpc: vi.fn().mockRejectedValue(transportError),
    }).recordWear(request).catch((reason) => reason);

    expect(error).toMatchObject({
      cause: transportError,
      retryContext: request,
    });
  });

  it("lists newest wear events with their immutable item membership", async () => {
    const rows = [{
      id: "wear-2",
      worn_at: "2026-07-17T12:00:00.000Z",
      outfit: { id: "outfit-a", name: "Office day" },
      wear_event_items: [{
        wardrobe_item_id: "archived-a",
        wardrobe_item: { id: "archived-a", name: "Old trousers", status: "archived" },
      }],
    }];
    const query = createQuery({ data: rows, error: null });
    const client = { from: vi.fn(() => query) };

    const result = await createWardrobeRepository(client).listWearHistory();

    expect(client.from).toHaveBeenCalledWith("wear_events");
    expect(query.select).toHaveBeenCalledWith(
      "*, outfit:outfits(id, name), wear_event_items(*, wardrobe_item:wardrobe_items(id, name, status))",
    );
    expect(query.order).toHaveBeenCalledWith("worn_at", { ascending: false });
    expect(result[0]).toMatchObject({
      id: "wear-2",
      items: [{ id: "archived-a", name: "Old trousers", status: "archived" }],
    });
  });

  it("derives last-worn timestamps from the read-only view", async () => {
    const itemQuery = createQuery({
      data: [{ id: "item-a", cutout_path: "owner/item-a.png" }],
      error: null,
    });
    const lastWornQuery = createQuery({
      data: [{ wardrobe_item_id: "item-a", last_worn_at: "2026-07-16T12:00:00.000Z" }],
      error: null,
    });
    const imagesQuery = createImagesQuery();
    const client = {
      from: vi.fn((table) => {
        if (table === "wardrobe_item_images") return imagesQuery;
        return table === "wardrobe_items" ? itemQuery : lastWornQuery;
      }),
      storage: {
        from: vi.fn(() => ({
          createSignedUrls: vi.fn().mockResolvedValue({
            data: [{ path: "owner/item-a.png", signedUrl: "https://assets.test/item-a" }],
            error: null,
          }),
        })),
      },
    };

    const result = await createWardrobeRepository(client).listItemsWithLastWorn();

    expect(client.from).toHaveBeenCalledWith("wardrobe_item_last_worn");
    expect(lastWornQuery.select).toHaveBeenCalledWith("wardrobe_item_id, last_worn_at");
    expect(result).toEqual([expect.objectContaining({
      id: "item-a",
      last_worn_at: "2026-07-16T12:00:00.000Z",
    })]);
  });

  it("keeps items visible and flags last-worn unavailable when the view fails", async () => {
    const itemQuery = createQuery({
      data: [{ id: "item-a", cutout_path: "owner/item-a.png" }],
      error: null,
    });
    const lastWornQuery = createQuery({ data: null, error: new Error("view unavailable") });
    const imagesQuery = createImagesQuery();
    const client = {
      from: vi.fn((table) => {
        if (table === "wardrobe_item_images") return imagesQuery;
        return table === "wardrobe_items" ? itemQuery : lastWornQuery;
      }),
      storage: {
        from: vi.fn(() => ({
          createSignedUrls: vi.fn().mockResolvedValue({
            data: [{ path: "owner/item-a.png", signedUrl: "https://assets.test/item-a" }],
            error: null,
          }),
        })),
      },
    };

    const result = await createWardrobeRepository(client).listItemsWithLastWorn();

    expect(result).toEqual([expect.objectContaining({
      id: "item-a",
      last_worn_at: null,
      last_worn_unavailable: true,
    })]);
  });

  it("lists only active items by default", async () => {
    const query = createQuery({ data: [], error: null });
    const { client, createSignedUrls } = createClient(query);

    const result = await createWardrobeRepository(client).listItems();

    expect(result).toEqual([]);
    expect(client.from).toHaveBeenCalledWith("wardrobe_items");
    expect(query.select).toHaveBeenCalledWith("*, wardrobe_item_labels(label_id)");
    expect(query.eq).toHaveBeenCalledWith("status", "active");
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("includes archived items when requested", async () => {
    const items = [{ id: "archived", status: "archived", cutout_path: "cutouts/archived.png" }];
    const query = createQuery({ data: items, error: null });
    const { client } = createClient(query, {
      data: [{ path: "cutouts/archived.png", signedUrl: "https://assets.test/archived" }],
      error: null,
    });

    const result = await createWardrobeRepository(client).listItems({ includeArchived: true });

    expect(query.eq).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({ id: "archived", cutoutUrl: "https://assets.test/archived" });
  });

  it("creates cutout signed URLs in one batch while preserving item order", async () => {
    const items = [
      { id: "first", cutout_path: "cutouts/first.png" },
      { id: "second", cutout_path: "cutouts/second.png" },
    ];
    const query = createQuery({ data: items, error: null });
    const { client, createSignedUrls } = createClient(query, {
      data: [
        { path: "cutouts/first.png", signedUrl: "https://assets.test/first" },
        { path: "cutouts/second.png", signedUrl: "https://assets.test/second" },
      ],
      error: null,
    });

    const result = await createWardrobeRepository(client).listItems();

    expect(client.storage.from).toHaveBeenCalledWith("wardrobe-assets");
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(
      ["cutouts/first.png", "cutouts/second.png"],
      3600,
    );
    expect(result.map(({ id, cutoutUrl }) => ({ id, cutoutUrl }))).toEqual([
      { id: "first", cutoutUrl: "https://assets.test/first" },
      { id: "second", cutoutUrl: "https://assets.test/second" },
    ]);
  });

  it("signs structured product images ordered by sort order and derives the primary", async () => {
    const items = [{ id: "item-a", cutout_path: "owner/items/item-a/wear-layer/1.png" }];
    const query = createQuery({ data: items, error: null });
    const { client, createSignedUrls, imagesQuery } = createClient(
      query,
      {
        data: [
          { path: "owner/items/item-a/wear-layer/1.png", signedUrl: "https://assets.test/layer" },
          { path: "owner/items/item-a/images/front.webp", signedUrl: "https://assets.test/front" },
          { path: "owner/items/item-a/images/back.webp", signedUrl: "https://assets.test/back" },
        ],
        error: null,
      },
      {
        data: [
          { id: "img-back", wardrobe_item_id: "item-a", storage_path: "owner/items/item-a/images/back.webp", view: "back", sort_order: 1, is_primary: false },
          { id: "img-front", wardrobe_item_id: "item-a", storage_path: "owner/items/item-a/images/front.webp", view: "front", sort_order: 0, is_primary: true },
        ],
        error: null,
      },
    );

    const [item] = await createWardrobeRepository(client).listItems();

    expect(client.from).toHaveBeenCalledWith("wardrobe_item_images");
    expect(imagesQuery.in).toHaveBeenCalledWith("wardrobe_item_id", ["item-a"]);
    expect(createSignedUrls).toHaveBeenCalledWith(
      [
        "owner/items/item-a/wear-layer/1.png",
        "owner/items/item-a/images/front.webp",
        "owner/items/item-a/images/back.webp",
      ],
      3600,
    );
    expect(item.primaryImageUrl).toBe("https://assets.test/front");
    expect(item.images).toEqual([
      { id: "img-front", view: "front", sortOrder: 0, isPrimary: true, url: "https://assets.test/front" },
      { id: "img-back", view: "back", sortOrder: 1, isPrimary: false, url: "https://assets.test/back" },
    ]);
  });

  it("falls back to the cutout as the primary image for legacy items without image rows", async () => {
    const items = [{ id: "legacy", cutout_path: "owner/items/legacy/cutout.png" }];
    const query = createQuery({ data: items, error: null });
    const { client } = createClient(query, {
      data: [{ path: "owner/items/legacy/cutout.png", signedUrl: "https://assets.test/legacy" }],
      error: null,
    });

    const [item] = await createWardrobeRepository(client).listItems();

    expect(item.images).toEqual([]);
    expect(item.primaryImageUrl).toBe("https://assets.test/legacy");
    expect(item.cutoutUrl).toBe("https://assets.test/legacy");
  });

  it("updates editable metadata and the full label set through the atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "item-1", error: null });
    const item = {
      id: "item-1",
      owner_id: "other-owner",
      status: "archived",
      cutoutUrl: "https://temporary.test/cutout",
      cutout_path: "cutouts/item-1.png",
      name: "Saved jacket",
      category: "jacket",
      brand: "Acme",
      size: "M",
      notes: "Dry clean",
      colors: ["#112233", "#445566"],
      tags: ["wool"],
      anchor_x: 0.4,
      anchor_y: 0.6,
      scale: 0.75,
      rotation_degrees: -2,
      layer_order: 42,
      labelIds: ["label-summer", "label-rainy"],
    };

    const result = await createWardrobeRepository({ rpc }).updateItem(item);

    expect(rpc).toHaveBeenCalledWith("update_wardrobe_item_with_labels", {
      p_item_id: "item-1",
      p_name: "Saved jacket",
      p_category: "jacket",
      p_slot: "outerwear",
      p_brand: "Acme",
      p_size: "M",
      p_notes: "Dry clean",
      p_colors: ["#112233", "#445566"],
      p_tags: ["wool"],
      p_anchor_x: 0.4,
      p_anchor_y: 0.6,
      p_scale: 0.75,
      p_rotation_degrees: -2,
      p_layer_order: 42,
      p_label_ids: ["label-summer", "label-rainy"],
    });
    expect(result).toMatchObject({
      id: "item-1",
      slot: "outerwear",
      labelIds: ["label-summer", "label-rainy"],
    });
  });

  it("archives through the transactional RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await expect(createWardrobeRepository({ rpc }).archiveItem("item-1"))
      .resolves.toBeNull();

    expect(rpc).toHaveBeenCalledWith("archive_wardrobe_item", {
      p_item_id: "item-1",
    });
  });

  it("restores through the owner-validating transactional RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await expect(createWardrobeRepository({ rpc }).restoreItem("item-1"))
      .resolves.toBeNull();

    expect(rpc).toHaveBeenCalledWith("restore_wardrobe_item", {
      p_item_id: "item-1",
    });
  });

  it("rejects an update whose category has no mapped slot", async () => {
    const query = createQuery({ data: null, error: null });
    const { client } = createClient(query);

    await expect(createWardrobeRepository(client).updateItem({
      id: "item-1",
      category: "all",
    })).rejects.toThrow("Category all has no wardrobe slot.");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("throws errors returned by Supabase", async () => {
    const error = new Error("database unavailable");
    const query = createQuery({ data: null, error });
    const { client } = createClient(query);

    await expect(createWardrobeRepository(client).listItems()).rejects.toBe(error);
  });

  it("throws top-level storage errors", async () => {
    const items = [{ id: "item-1", cutout_path: "cutouts/item-1.png" }];
    const query = createQuery({ data: items, error: null });
    const storageError = new Error("storage unavailable");
    const { client } = createClient(query, { data: null, error: storageError });

    await expect(createWardrobeRepository(client).listItems()).rejects.toBe(storageError);
  });

  it("wraps per-asset storage error strings as Errors", async () => {
    const query = createQuery({ data: [], error: null });
    const { client } = createClient(query, {
      data: [{ path: "cutouts/missing.png", signedUrl: null, error: "Object not found" }],
      error: null,
    });

    const error = await createWardrobeRepository(client)
      .createSignedAssetUrls(["cutouts/missing.png"])
      .catch((reason) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Object not found");
  });

  it("uses returned paths authoritatively when a signed URL is missing", async () => {
    const items = [
      { id: "first", cutout_path: "cutouts/first.png" },
      { id: "second", cutout_path: "cutouts/second.png" },
    ];
    const query = createQuery({ data: items, error: null });
    const { client } = createClient(query, {
      data: [
        { path: "cutouts/second.png", signedUrl: "https://assets.test/second" },
      ],
      error: null,
    });

    const result = await createWardrobeRepository(client).listItems();

    expect(result.map(({ id, cutoutUrl }) => ({ id, cutoutUrl }))).toEqual([
      { id: "first", cutoutUrl: null },
      { id: "second", cutoutUrl: "https://assets.test/second" },
    ]);
  });

  it("shares one matching signed URL across records with duplicate paths", async () => {
    const items = [
      { id: "first", cutout_path: "cutouts/shared.png" },
      { id: "second", cutout_path: "cutouts/shared.png" },
    ];
    const query = createQuery({ data: items, error: null });
    const { client } = createClient(query, {
      data: [
        { path: "cutouts/shared.png", signedUrl: "https://assets.test/shared" },
      ],
      error: null,
    });

    const result = await createWardrobeRepository(client).listItems();

    expect(result.map(({ id, cutoutUrl }) => ({ id, cutoutUrl }))).toEqual([
      { id: "first", cutoutUrl: "https://assets.test/shared" },
      { id: "second", cutoutUrl: "https://assets.test/shared" },
    ]);
  });

  it("maps an item's nested assignment rows to labelIds and strips the rows", async () => {
    const items = [{
      id: "item-a",
      cutout_path: "cutouts/a.png",
      wardrobe_item_labels: [{ label_id: "l1" }, { label_id: "l2" }],
    }];
    const query = createQuery({ data: items, error: null });
    const { client } = createClient(query, {
      data: [{ path: "cutouts/a.png", signedUrl: "https://assets.test/a" }],
      error: null,
    });

    const [item] = await createWardrobeRepository(client).listItems();

    expect(item.labelIds).toEqual(["l1", "l2"]);
    expect(item).not.toHaveProperty("wardrobe_item_labels");
  });

  it("lists labels mapping snake_case columns to camelCase", async () => {
    const rows = [
      { id: "s1", kind: "season", season_key: "summer", name: "Summer", locked: true },
      { id: "t1", kind: "theme", season_key: null, name: "Rainy day", locked: false },
    ];
    const query = createQuery({ data: rows, error: null });
    const client = { from: vi.fn(() => query) };

    const result = await createWardrobeRepository(client).listLabels();

    expect(client.from).toHaveBeenCalledWith("wardrobe_labels");
    expect(query.select).toHaveBeenCalledWith("id, kind, season_key, name, locked");
    expect(result).toEqual([
      { id: "s1", kind: "season", seasonKey: "summer", name: "Summer", locked: true },
      { id: "t1", kind: "theme", seasonKey: null, name: "Rainy day", locked: false },
    ]);
  });

  it("creates a theme with a trimmed name for the authenticated owner", async () => {
    const query = {
      insert: vi.fn(() => query),
      select: vi.fn(() => query),
      single: vi.fn().mockResolvedValue({
        data: { id: "t1", kind: "theme", season_key: null, name: "Rainy day", locked: false },
        error: null,
      }),
    };
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null }) },
      from: vi.fn(() => query),
    };

    const result = await createWardrobeRepository(client).createTheme("  Rainy day  ");

    expect(client.from).toHaveBeenCalledWith("wardrobe_labels");
    expect(query.insert).toHaveBeenCalledWith({
      owner_id: "owner-1", kind: "theme", season_key: null, locked: false, name: "Rainy day",
    });
    expect(result).toEqual({ id: "t1", kind: "theme", seasonKey: null, name: "Rainy day", locked: false });
  });

  it("renames a theme scoped to unlocked owned themes and trims the name", async () => {
    const query = {
      update: vi.fn(() => query),
      eq: vi.fn(() => query),
      select: vi.fn(() => query),
      single: vi.fn().mockResolvedValue({
        data: { id: "t1", kind: "theme", season_key: null, name: "Storm", locked: false },
        error: null,
      }),
    };
    const client = { from: vi.fn(() => query) };

    const result = await createWardrobeRepository(client).renameTheme("t1", "  Storm  ");

    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ name: "Storm" }));
    expect(query.eq).toHaveBeenCalledWith("id", "t1");
    expect(query.eq).toHaveBeenCalledWith("kind", "theme");
    expect(query.eq).toHaveBeenCalledWith("locked", false);
    expect(result).toEqual({ id: "t1", kind: "theme", seasonKey: null, name: "Storm", locked: false });
  });

  it("deletes a theme scoped to unlocked owned themes", async () => {
    const query = {
      delete: vi.fn(() => query),
      eq: vi.fn(() => query),
      then: (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
    };
    const client = { from: vi.fn(() => query) };

    await createWardrobeRepository(client).deleteTheme("t1");

    expect(query.delete).toHaveBeenCalledTimes(1);
    expect(query.eq).toHaveBeenCalledWith("id", "t1");
    expect(query.eq).toHaveBeenCalledWith("kind", "theme");
    expect(query.eq).toHaveBeenCalledWith("locked", false);
  });
});
