import { afterEach, describe, expect, it, vi } from "vitest";
import { createWardrobeRepository } from "./wardrobeRepository.js";

function createQuery(result) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

function outfitClient({ queryResult, signedResult, uploadResult, rpcResult } = {}) {
  const query = createQuery(queryResult ?? { data: null, error: null });
  const createSignedUrls = vi.fn().mockResolvedValue(signedResult ?? { data: [], error: null });
  const upload = vi.fn().mockResolvedValue(uploadResult ?? { data: {}, error: null });
  const remove = vi.fn().mockResolvedValue({ data: {}, error: null });
  const rpc = vi.fn().mockResolvedValue(rpcResult ?? { data: null, error: null });
  return {
    client: {
      from: vi.fn(() => query),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null }) },
      rpc,
      storage: { from: vi.fn(() => ({ createSignedUrls, upload, remove })) },
    },
    query, createSignedUrls, upload, remove, rpc,
  };
}

const savedRows = [{
  id: "outfit-1",
  name: "Office day",
  thumbnail_path: "owner-1/outfits/outfit-1/thumbnail-old-version.webp",
  needs_attention: true,
  outfit_items: [
    { slot: "bottom", layer_order: 30, wardrobe_item: { id: "bottom-1", name: "Old trousers", status: "archived", slot: "bottom", layer_order: 30, cutout_path: "owner-1/items/bottom.png" } },
    { slot: "top", layer_order: 20, wardrobe_item: { id: "top-1", name: "Blue top", status: "active", slot: "top", layer_order: 20, cutout_path: "owner-1/items/top.png" } },
  ],
}];

afterEach(() => vi.unstubAllGlobals());

describe("saved outfit repository", () => {
  it("lists outfits with ordered item rows and private signed thumbnails", async () => {
    const { client, query, createSignedUrls } = outfitClient({
      queryResult: { data: savedRows, error: null },
      signedResult: { data: [{ path: savedRows[0].thumbnail_path, signedUrl: "https://assets.test/outfit.webp" }], error: null },
    });
    const result = await createWardrobeRepository(client).listOutfits();
    expect(client.from).toHaveBeenCalledWith("outfits");
    expect(query.select).toHaveBeenCalledWith("*, outfit_items(*, wardrobe_item:wardrobe_items(*)), outfit_labels(label_id)");
    expect(query.order).toHaveBeenCalledWith("updated_at", { ascending: false });
    expect(createSignedUrls).toHaveBeenCalledWith([savedRows[0].thumbnail_path], 3600);
    expect(result[0]).toMatchObject({
      id: "outfit-1", thumbnailUrl: "https://assets.test/outfit.webp",
      items: [
        { id: "top-1", status: "active", saved_slot: "top" },
        { id: "bottom-1", status: "archived", saved_slot: "bottom" },
      ],
    });
  });

  it("uploads a new private thumbnail, saves ordered IDs, and refetches the outfit", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn()
      .mockReturnValueOnce("outfit-new")
      .mockReturnValueOnce("thumbnail-version") });
    const thumbnailBlob = new Blob(["webp"], { type: "image/webp" });
    const row = { ...savedRows[0], id: "outfit-new", name: "Weekend", thumbnail_path: "owner-1/outfits/outfit-new/thumbnail-thumbnail-version.webp" };
    const { client, query, upload, rpc, createSignedUrls } = outfitClient({
      queryResult: { data: row, error: null },
      signedResult: { data: [{ path: row.thumbnail_path, signedUrl: "https://assets.test/new.webp" }], error: null },
      rpcResult: { data: "outfit-new", error: null },
    });
    const result = await createWardrobeRepository(client).saveOutfit({
      name: " Weekend ", items: [{ id: "top-1" }, { id: "bottom-1" }], thumbnailBlob,
      labelIds: ["label-summer"],
    });
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith("owner-1/outfits/outfit-new/thumbnail-thumbnail-version.webp", thumbnailBlob, { contentType: "image/webp", upsert: false });
    expect(rpc).toHaveBeenCalledWith("save_outfit_with_labels", {
      p_outfit_id: "outfit-new", p_name: "Weekend", p_item_ids: ["top-1", "bottom-1"],
      p_layer_orders: [10, 20],
      p_thumbnail_path: "owner-1/outfits/outfit-new/thumbnail-thumbnail-version.webp",
      p_label_ids: ["label-summer"],
    });
    expect(query.eq).toHaveBeenCalledWith("id", "outfit-new");
    expect(query.single).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith([row.thumbnail_path], 3600);
    expect(result).toMatchObject({ id: "outfit-new", thumbnailUrl: "https://assets.test/new.webp" });
  });

  it("reuses an existing outfit ID when updating", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "thumbnail-version") });
    const thumbnailBlob = new Blob(["webp"], { type: "image/webp" });
    const { client, upload, rpc } = outfitClient({ queryResult: { data: savedRows[0], error: null } });
    await createWardrobeRepository(client).saveOutfit({
      id: "outfit-1", name: "Renamed", items: [{ id: "top-1" }, { id: "bottom-1" }], thumbnailBlob,
    });
    expect(upload).toHaveBeenCalledWith("owner-1/outfits/outfit-1/thumbnail-thumbnail-version.webp", thumbnailBlob, { contentType: "image/webp", upsert: false });
    expect(rpc).toHaveBeenCalledWith("save_outfit_with_labels", expect.objectContaining({ p_outfit_id: "outfit-1", p_label_ids: [] }));
  });

  it("rolls back the new thumbnail when the RPC fails", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "thumbnail-version") });
    const rpcError = new Error("database unavailable");
    const { client, remove } = outfitClient({ rpcResult: { data: null, error: rpcError } });
    const error = await createWardrobeRepository(client).saveOutfit({
      id: "outfit-1", name: "Office day", items: [{ id: "top-1" }, { id: "bottom-1" }], thumbnailBlob: new Blob(),
    }).catch((reason) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ cause: rpcError });
    expect(error.recoverable).not.toBe(true);
    expect(remove).toHaveBeenCalledWith(["owner-1/outfits/outfit-1/thumbnail-thumbnail-version.webp"]);
  });

  it("does not call the RPC when thumbnail upload fails", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "thumbnail-version") });
    const uploadError = new Error("storage unavailable");
    const { client, rpc } = outfitClient({ uploadResult: { data: null, error: uploadError } });
    await expect(createWardrobeRepository(client).saveOutfit({
      id: "outfit-1", name: "Office day", items: [{ id: "top-1" }, { id: "bottom-1" }], thumbnailBlob: new Blob(),
    })).rejects.toBe(uploadError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("exposes outfit labelIds and strips the nested assignment rows", async () => {
    const rows = [{ ...savedRows[0], outfit_labels: [{ label_id: "l1" }, { label_id: "l2" }] }];
    const { client } = outfitClient({
      queryResult: { data: rows, error: null },
      signedResult: { data: [{ path: savedRows[0].thumbnail_path, signedUrl: "https://assets.test/o.webp" }], error: null },
    });

    const [outfit] = await createWardrobeRepository(client).listOutfits();

    expect(outfit.labelIds).toEqual(["l1", "l2"]);
    expect(outfit).not.toHaveProperty("outfit_labels");
  });

  it("returns a committed fallback that retains labels when the refetch fails", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn()
      .mockReturnValueOnce("outfit-new")
      .mockReturnValueOnce("thumbnail-version") });
    const { client } = outfitClient({
      queryResult: { data: null, error: new Error("refetch failed") },
      rpcResult: { data: "outfit-new", error: null },
    });

    const result = await createWardrobeRepository(client).saveOutfit({
      name: "Weekend", items: [{ id: "top-1" }, { id: "bottom-1" }],
      thumbnailBlob: new Blob(), labelIds: ["label-summer"],
    });

    expect(result).toMatchObject({ id: "outfit-new", committed: true, labelIds: ["label-summer"] });
  });
});
