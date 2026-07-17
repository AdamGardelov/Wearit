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

function createClient(query, signedResult = { data: [], error: null }) {
  const createSignedUrls = vi.fn().mockResolvedValue(signedResult);
  return {
    client: {
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({ createSignedUrls })) },
    },
    createSignedUrls,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createWardrobeRepository", () => {
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
    const client = {
      from: vi.fn((table) => table === "wardrobe_items" ? itemQuery : lastWornQuery),
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

  it("lists only active items by default", async () => {
    const query = createQuery({ data: [], error: null });
    const { client, createSignedUrls } = createClient(query);

    const result = await createWardrobeRepository(client).listItems();

    expect(result).toEqual([]);
    expect(client.from).toHaveBeenCalledWith("wardrobe_items");
    expect(query.select).toHaveBeenCalledWith("*");
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

  it("updates only editable metadata and placement fields", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const saved = { id: "item-1", name: "Saved jacket", category: "jacket", slot: "outerwear" };
    const query = createQuery({ data: saved, error: null });
    const { client } = createClient(query);
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
    };

    const result = await createWardrobeRepository(client).updateItem(item);

    expect(query.update).toHaveBeenCalledWith({
      name: "Saved jacket",
      category: "jacket",
      slot: "outerwear",
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
      updated_at: NOW,
    });
    expect(query.eq).toHaveBeenCalledWith("id", "item-1");
    expect(result).toEqual(saved);
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
});
