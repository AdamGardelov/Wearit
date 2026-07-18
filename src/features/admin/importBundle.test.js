import { afterEach, describe, expect, it, vi } from "vitest";
import { parseImportBundle } from "./importBundle.js";

const ITEM_ID = "96541a13-deb2-51da-bc91-8d0505624551";
const PLACEMENT = {
  anchorX: 0.5,
  anchorY: 0.38,
  scale: 0.66,
  rotationDegrees: 0,
  layerOrder: 40,
};

function manifestItem(overrides = {}) {
  return {
    id: ITEM_ID,
    file: `assets/${ITEM_ID}/cutout.png`,
    detailFiles: [],
    name: "Navy cardigan",
    category: "jacket",
    slot: "outerwear",
    colors: ["#172033"],
    tags: ["knit"],
    placement: PLACEMENT,
    status: "accepted",
    ...overrides,
  };
}

function bundleFile(path, contents = "asset", type = "application/octet-stream") {
  const file = new File([contents], path.split("/").at(-1), { type });
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: `pilot/${path}`,
  });
  return file;
}

function manifestFile(items = [manifestItem()], version = 1, path = "manifest.json") {
  return bundleFile(path, JSON.stringify({ version, items }), "application/json");
}

function validFiles(item = manifestItem()) {
  return [
    manifestFile([item]),
    bundleFile(item.file, "png", "image/png"),
  ];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseImportBundle", () => {
  it("builds a local review draft and revokes its object URLs on cleanup", async () => {
    const createObjectURL = vi.fn(() => "blob:review-cutout");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const bundle = await parseImportBundle(validFiles());

    expect(bundle.items).toEqual([{
      manifestItem: manifestItem(),
      cutoutFile: expect.any(File),
      detailFiles: [],
      imageFiles: [],
      cutoutUrl: "blob:review-cutout",
      placement: PLACEMENT,
    }]);
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    bundle.cleanup();
    bundle.cleanup();

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:review-cutout");
  });

  it("matches every referenced detail derivative by its exact path", async () => {
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:cutout"), revokeObjectURL: vi.fn() });
    const item = manifestItem({
      detailFiles: [
        `assets/${ITEM_ID}/details/label.webp`,
        `assets/${ITEM_ID}/details/zip.jpg`,
      ],
    });

    const bundle = await parseImportBundle([
      manifestFile([item]),
      bundleFile(item.file, "png", "image/png"),
      bundleFile(item.detailFiles[1], "jpg", "image/jpeg"),
      bundleFile(item.detailFiles[0], "webp", "image/webp"),
    ]);

    expect(bundle.items[0].detailFiles.map((file) => file.webkitRelativePath)).toEqual([
      `pilot/${item.detailFiles[0]}`,
      `pilot/${item.detailFiles[1]}`,
    ]);
    bundle.cleanup();
  });

  it.each([
    ["a missing manifest", [bundleFile(`assets/${ITEM_ID}/cutout.png`, "png", "image/png")], /one manifest\.json/i],
    ["duplicate manifests", [manifestFile(), manifestFile([], 1, "nested/manifest.json"), bundleFile(`assets/${ITEM_ID}/cutout.png`, "png", "image/png")], /one manifest\.json/i],
    ["the wrong version", validFiles(), /version 1 or 2/i, 3],
    ["a missing cutout", [manifestFile()], /missing.*cutout/i],
    ["duplicate cutout paths", [...validFiles(), bundleFile(`assets/${ITEM_ID}/cutout.png`, "second", "image/png")], /duplicate.*cutout|duplicate.*path/i],
    ["an unreferenced cutout", [...validFiles(), bundleFile("assets/other/cutout.png", "png", "image/png")], /unreferenced.*cutout|unreferenced.*file/i],
    ["an unreferenced detail", [...validFiles(), bundleFile(`assets/${ITEM_ID}/details/extra.webp`, "webp", "image/webp")], /unreferenced.*detail|unreferenced.*file/i],
    ["a raw JPEG", [...validFiles(), bundleFile("raw/source.jpg", "raw", "image/jpeg")], /raw source.*refused/i],
    ["a raw HEIC", [...validFiles(), bundleFile("raw/source.heic", "raw", "image/heic")], /raw source.*refused/i],
    ["a raw TIFF", [...validFiles(), bundleFile("raw/source.tiff", "raw", "image/tiff")], /raw source.*refused/i],
  ])("rejects %s before creating object URLs", async (_label, files, expected, version) => {
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const selectedFiles = version
      ? [manifestFile([manifestItem()], version), files[1]]
      : files;

    await expect(parseImportBundle(selectedFiles)).rejects.toThrow(expected);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects manifest records and references that are not exact accepted bundle assets", async () => {
    vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
    const item = manifestItem({ status: "hold" });

    await expect(parseImportBundle(validFiles(item))).rejects.toThrow(/accepted/i);
  });
});

const FRONT_ID = "11111111-1111-4111-8111-111111111111";
const BACK_ID = "22222222-2222-4222-8222-222222222222";

function manifestItemV2(overrides = {}) {
  return {
    id: ITEM_ID,
    wearLayerFile: `assets/${ITEM_ID}/wear-layer.png`,
    name: "Disco tee",
    category: "top",
    slot: "top",
    colors: ["#202020"],
    tags: ["tshirt"],
    images: [
      { id: FRONT_ID, file: `assets/${ITEM_ID}/images/front.webp`, view: "front", sortOrder: 0, isPrimary: true },
      { id: BACK_ID, file: `assets/${ITEM_ID}/images/back.webp`, view: "back", sortOrder: 1, isPrimary: false },
    ],
    placement: PLACEMENT,
    status: "accepted",
    ...overrides,
  };
}

function validFilesV2(item = manifestItemV2()) {
  return [
    manifestFile([item], 2),
    bundleFile(item.wearLayerFile, "png", "image/png"),
    ...item.images.map((image) => bundleFile(image.file, "webp", "image/webp")),
  ];
}

describe("parseImportBundle version 2", () => {
  it("parses a front/back bundle into wear-layer and aligned product images", async () => {
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:wear-layer"), revokeObjectURL: vi.fn() });

    const bundle = await parseImportBundle(validFilesV2());
    const [draft] = bundle.items;

    expect(draft.manifestItem.version).toBe(2);
    expect(draft.cutoutUrl).toBe("blob:wear-layer");
    expect(draft.cutoutFile).toBeInstanceOf(File);
    expect(draft.manifestItem.images).toEqual([
      { id: FRONT_ID, view: "front", sortOrder: 0, isPrimary: true },
      { id: BACK_ID, view: "back", sortOrder: 1, isPrimary: false },
    ]);
    expect(draft.imageFiles.map((image) => [image.view, image.file instanceof File])).toEqual([
      ["front", true],
      ["back", true],
    ]);
    bundle.cleanup();
  });

  it("rejects a v2 item whose primary is not the front image", async () => {
    vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
    const item = manifestItemV2({
      images: [
        { id: FRONT_ID, file: `assets/${ITEM_ID}/images/front.webp`, view: "front", sortOrder: 0, isPrimary: false },
        { id: BACK_ID, file: `assets/${ITEM_ID}/images/back.webp`, view: "back", sortOrder: 1, isPrimary: true },
      ],
    });

    await expect(parseImportBundle(validFilesV2(item))).rejects.toThrow(/primary/i);
  });

  it("rejects a v2 item missing its front image", async () => {
    vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
    const item = manifestItemV2({
      images: [
        { id: FRONT_ID, file: `assets/${ITEM_ID}/images/only.webp`, view: "detail", sortOrder: 0, isPrimary: true },
      ],
    });

    await expect(parseImportBundle(validFilesV2(item))).rejects.toThrow(/front|primary/i);
  });
});
