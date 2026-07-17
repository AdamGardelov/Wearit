import { afterEach, describe, expect, it, vi } from "vitest";
import { createWardrobeRepository } from "./wardrobeRepository.js";

const OUTFIT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NEW_PATH = `owner-1/outfits/${OUTFIT_ID}/thumbnail-${VERSION_ID}.webp`;
const OLD_PATH = `owner-1/outfits/${OUTFIT_ID}/thumbnail-cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp`;

function query(result) {
  const value = {
    select: vi.fn(() => value),
    eq: vi.fn(() => value),
    order: vi.fn(() => value),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return value;
}

function clientFor({
  queryResults = [],
  rpcResult = { data: OUTFIT_ID, error: null },
  signedResult = { data: [{ path: NEW_PATH, signedUrl: "https://assets.test/new.webp" }], error: null },
  removeResults = [],
} = {}) {
  const queries = queryResults.map(query);
  const upload = vi.fn().mockResolvedValue({ data: {}, error: null });
  const remove = vi.fn();
  for (const result of removeResults) remove.mockResolvedValueOnce(result);
  remove.mockResolvedValue({ data: {}, error: null });
  const createSignedUrls = vi.fn().mockResolvedValue(signedResult);
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const client = {
    from: vi.fn(() => queries.shift()),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null }) },
    rpc,
    storage: { from: vi.fn(() => ({ upload, remove, createSignedUrls })) },
  };
  return { client, upload, remove, rpc };
}

function savedRow(overrides = {}) {
  return {
    id: OUTFIT_ID,
    name: "Office day",
    thumbnail_path: NEW_PATH,
    outfit_items: [],
    ...overrides,
  };
}

const items = [
  { id: "top-1", slot: "top" },
  { id: "bottom-1", slot: "bottom" },
];

afterEach(() => vi.unstubAllGlobals());

describe("outfit thumbnail transaction boundaries", () => {
  it("uploads a new outfit thumbnail at an immutable versioned path", async () => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn()
        .mockReturnValueOnce(OUTFIT_ID)
        .mockReturnValueOnce(VERSION_ID),
    });
    const { client, upload, rpc } = clientFor({
      queryResults: [{ data: savedRow(), error: null }],
    });

    await createWardrobeRepository(client).saveOutfit({ name: "Office day", items, thumbnailBlob: new Blob() });

    expect(upload).toHaveBeenCalledWith(NEW_PATH, expect.any(Blob), {
      contentType: "image/webp",
      upsert: false,
    });
    expect(rpc).toHaveBeenCalledWith("save_outfit", expect.objectContaining({
      p_outfit_id: OUTFIT_ID,
      p_thumbnail_path: NEW_PATH,
    }));
  });

  it("reads the prior update path and removes it only after the RPC commits", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => VERSION_ID) });
    const { client, remove, rpc } = clientFor({
      queryResults: [
        { data: { thumbnail_path: OLD_PATH }, error: null },
        { data: savedRow(), error: null },
      ],
    });

    await createWardrobeRepository(client).saveOutfit({ id: OUTFIT_ID, name: "Renamed", items, thumbnailBlob: new Blob() });

    expect(client.from).toHaveBeenNthCalledWith(1, "outfits");
    expect(rpc).toHaveBeenCalledBefore(remove);
    expect(remove).toHaveBeenCalledWith([OLD_PATH]);
  });

  it("removes the new object after an RPC failure without touching the prior preview", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => VERSION_ID) });
    const rpcError = new Error("database unavailable");
    const { client, remove } = clientFor({
      queryResults: [{ data: { thumbnail_path: OLD_PATH }, error: null }],
      rpcResult: { data: null, error: rpcError },
    });

    const error = await createWardrobeRepository(client).saveOutfit({
      id: OUTFIT_ID, name: "Renamed", items, thumbnailBlob: new Blob(),
    }).catch((reason) => reason);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([NEW_PATH]);
    expect(error).toMatchObject({ cause: rpcError });
    expect(error.recoverable).not.toBe(true);
  });

  it("returns the new path for reconciliation only when rollback cleanup also fails", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => VERSION_ID) });
    const rpcError = new Error("database unavailable");
    const { client } = clientFor({
      queryResults: [{ data: { thumbnail_path: OLD_PATH }, error: null }],
      rpcResult: { data: null, error: rpcError },
      removeResults: [{ data: null, error: new Error("cleanup unavailable") }],
    });

    const error = await createWardrobeRepository(client).saveOutfit({
      id: OUTFIT_ID, name: "Renamed", items, thumbnailBlob: new Blob(),
    }).catch((reason) => reason);

    expect(error).toMatchObject({ recoverable: true, uploadedPath: NEW_PATH, cause: rpcError });
  });

  it("returns an optimistic committed outfit when post-commit refetch fails", async () => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn()
        .mockReturnValueOnce(OUTFIT_ID)
        .mockReturnValueOnce(VERSION_ID),
    });
    const { client, rpc } = clientFor({
      queryResults: [{ data: null, error: new Error("refetch unavailable") }],
    });

    const result = await createWardrobeRepository(client).saveOutfit({
      name: "Office day", items, thumbnailBlob: new Blob(),
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      id: OUTFIT_ID,
      name: "Office day",
      items,
      thumbnail_path: NEW_PATH,
      committed: true,
    });
    expect(result.refreshWarning).toMatch(/saved/i);
  });

  it("keeps a committed save successful when old-object cleanup fails", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => VERSION_ID) });
    const cleanupError = new Error("cleanup unavailable");
    const { client } = clientFor({
      queryResults: [
        { data: { thumbnail_path: OLD_PATH }, error: null },
        { data: savedRow(), error: null },
      ],
      removeResults: [{ data: null, error: cleanupError }],
    });

    const result = await createWardrobeRepository(client).saveOutfit({
      id: OUTFIT_ID, name: "Renamed", items, thumbnailBlob: new Blob(),
    });

    expect(result.id).toBe(OUTFIT_ID);
    expect(result.cleanupWarning).toMatch(/old thumbnail/i);
  });
});
