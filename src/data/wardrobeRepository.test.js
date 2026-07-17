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

  it("archives an item with an archive timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const archived = { id: "item-1", status: "archived", archived_at: NOW };
    const query = createQuery({ data: archived, error: null });
    const { client } = createClient(query);

    const result = await createWardrobeRepository(client).archiveItem("item-1");

    expect(query.update).toHaveBeenCalledWith({ status: "archived", archived_at: NOW });
    expect(query.eq).toHaveBeenCalledWith("id", "item-1");
    expect(result).toEqual(archived);
  });

  it("restores an item to active status and clears its archive timestamp", async () => {
    const restored = { id: "item-1", status: "active", archived_at: null };
    const query = createQuery({ data: restored, error: null });
    const { client } = createClient(query);

    const result = await createWardrobeRepository(client).restoreItem("item-1");

    expect(query.update).toHaveBeenCalledWith({ status: "active", archived_at: null });
    expect(query.eq).toHaveBeenCalledWith("id", "item-1");
    expect(result).toEqual(restored);
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
