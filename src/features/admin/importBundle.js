const RAW_SOURCE_EXTENSIONS = new Set(["jpg", "jpeg", "heic", "heif", "tif", "tiff"]);
const DETAIL_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const VIEWS = new Set(["front", "back", "detail"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function selectedPath(file) {
  return String(file.webkitRelativePath || file.name || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
}

function relativeBundlePath(file, rootPrefix) {
  const path = selectedPath(file);
  return rootPrefix && path.startsWith(rootPrefix) ? path.slice(rootPrefix.length) : path;
}

function extension(path) {
  return path.split(".").at(-1)?.toLowerCase() || "";
}

function assertAssetPath(path, label) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("..") || path.includes("\\")) {
    throw new Error(`${label} must be an exact relative bundle path.`);
  }
}

function validateManifestItem(item, index) {
  const label = `items[${index}]`;
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`${label} must be an accepted manifest item.`);
  }
  if (item.status !== "accepted") throw new Error(`${label} must have accepted status.`);
  if (!UUID.test(item.id || "")) throw new Error(`${label}.id must be a UUID.`);
  assertAssetPath(item.file, `${label}.file`);
  if (item.file !== `assets/${item.id}/cutout.png`) {
    throw new Error(`${label}.file must be the exact cutout path for its stable ID.`);
  }
  if (!Array.isArray(item.detailFiles)) throw new Error(`${label}.detailFiles must be an array.`);
  const detailPaths = new Set();
  item.detailFiles.forEach((path, detailIndex) => {
    assertAssetPath(path, `${label}.detailFiles[${detailIndex}]`);
    if (!path.startsWith(`assets/${item.id}/details/`) || !DETAIL_EXTENSIONS.has(extension(path))) {
      throw new Error(`${label}.detailFiles[${detailIndex}] is not an approved detail derivative.`);
    }
    if (detailPaths.has(path)) throw new Error(`${label} has a duplicate detail path: ${path}`);
    detailPaths.add(path);
  });
  if (!item.placement || typeof item.placement !== "object") {
    throw new Error(`${label}.placement is required.`);
  }
}

function validateManifestItemV2(item, index) {
  const label = `items[${index}]`;
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`${label} must be an accepted manifest item.`);
  }
  if (item.status !== "accepted") throw new Error(`${label} must have accepted status.`);
  if (!UUID.test(item.id || "")) throw new Error(`${label}.id must be a UUID.`);
  if (typeof item.name !== "string" || !item.name.trim()) throw new Error(`${label}.name is required.`);
  assertAssetPath(item.wearLayerFile, `${label}.wearLayerFile`);
  if (item.wearLayerFile !== `assets/${item.id}/wear-layer.png`) {
    throw new Error(`${label}.wearLayerFile must be the exact wear-layer path for its stable ID.`);
  }
  if (!Array.isArray(item.images) || item.images.length < 1) {
    throw new Error(`${label}.images must list at least one product image.`);
  }

  const imageIds = new Set();
  const imagePaths = new Set();
  const sortOrders = new Set();
  let primaryCount = 0;
  let frontCount = 0;
  let backCount = 0;
  item.images.forEach((image, imageIndex) => {
    const imageLabel = `${label}.images[${imageIndex}]`;
    if (!image || typeof image !== "object" || Array.isArray(image)) {
      throw new Error(`${imageLabel} must be an object.`);
    }
    if (!UUID.test(image.id || "")) throw new Error(`${imageLabel}.id must be a UUID.`);
    assertAssetPath(image.file, `${imageLabel}.file`);
    if (!image.file.startsWith(`assets/${item.id}/images/`) || !DETAIL_EXTENSIONS.has(extension(image.file))) {
      throw new Error(`${imageLabel}.file is not an approved product image derivative.`);
    }
    if (!VIEWS.has(image.view)) throw new Error(`${imageLabel}.view must be front, back, or detail.`);
    if (!Number.isInteger(image.sortOrder) || image.sortOrder < 0) {
      throw new Error(`${imageLabel}.sortOrder must be a non-negative integer.`);
    }
    if (typeof image.isPrimary !== "boolean") throw new Error(`${imageLabel}.isPrimary must be a boolean.`);
    if (image.isPrimary) {
      primaryCount += 1;
      if (image.view !== "front") throw new Error(`${imageLabel} primary image must be the front view.`);
    }
    if (image.view === "front") frontCount += 1;
    if (image.view === "back") backCount += 1;
    if (imageIds.has(image.id)) throw new Error(`${imageLabel}.id is duplicated.`);
    if (imagePaths.has(image.file)) throw new Error(`${imageLabel}.file is duplicated.`);
    if (sortOrders.has(image.sortOrder)) throw new Error(`${imageLabel}.sortOrder is duplicated.`);
    imageIds.add(image.id);
    imagePaths.add(image.file);
    sortOrders.add(image.sortOrder);
  });
  if (primaryCount !== 1) throw new Error(`${label} must have exactly one primary image.`);
  if (frontCount !== 1) throw new Error(`${label} requires exactly one front image.`);
  if (backCount > 1) throw new Error(`${label} may have at most one back image.`);
  if (!item.placement || typeof item.placement !== "object") {
    throw new Error(`${label}.placement is required.`);
  }
}

function buildBundleV1(manifest, filesByPath) {
  const referencedPaths = new Set(["manifest.json"]);
  const seenItemIds = new Set();
  for (const [index, item] of manifest.items.entries()) {
    validateManifestItem(item, index);
    if (seenItemIds.has(item.id)) throw new Error(`The manifest has a duplicate item ID: ${item.id}`);
    seenItemIds.add(item.id);
    if (referencedPaths.has(item.file)) throw new Error(`The manifest has a duplicate cutout path: ${item.file}`);
    referencedPaths.add(item.file);
    item.detailFiles.forEach((path) => {
      if (referencedPaths.has(path)) throw new Error(`The manifest has a duplicate asset path: ${path}`);
      referencedPaths.add(path);
    });
  }

  for (const item of manifest.items) {
    const cutout = filesByPath.get(item.file);
    if (!cutout) throw new Error(`Missing cutout for ${item.name}: ${item.file}`);
    if (extension(item.file) !== "png" || (cutout.type && cutout.type !== "image/png")) {
      throw new Error(`Cutout ${item.file} must be a PNG derivative.`);
    }
    for (const path of item.detailFiles) {
      if (!filesByPath.has(path)) throw new Error(`Missing detail derivative: ${path}`);
    }
  }

  for (const path of filesByPath.keys()) {
    if (referencedPaths.has(path)) continue;
    if (RAW_SOURCE_EXTENSIONS.has(extension(path))) {
      throw new Error(`Raw source files are refused: ${path}`);
    }
    const kind = path.endsWith("/cutout.png") ? "cutout" : path.includes("/details/") ? "detail" : "file";
    throw new Error(`Unreferenced ${kind} in bundle: ${path}`);
  }

  const objectUrls = [];
  try {
    const items = manifest.items.map((manifestItem) => {
      const cutoutFile = filesByPath.get(manifestItem.file);
      const cutoutUrl = URL.createObjectURL(cutoutFile);
      objectUrls.push(cutoutUrl);
      return {
        manifestItem,
        cutoutFile,
        detailFiles: manifestItem.detailFiles.map((path) => filesByPath.get(path)),
        imageFiles: [],
        cutoutUrl,
        placement: { ...manifestItem.placement },
      };
    });
    return withCleanup(items, objectUrls);
  } catch (error) {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
}

function buildBundleV2(manifest, filesByPath) {
  const referencedPaths = new Set(["manifest.json"]);
  const seenItemIds = new Set();
  for (const [index, item] of manifest.items.entries()) {
    validateManifestItemV2(item, index);
    if (seenItemIds.has(item.id)) throw new Error(`The manifest has a duplicate item ID: ${item.id}`);
    seenItemIds.add(item.id);
    if (referencedPaths.has(item.wearLayerFile)) {
      throw new Error(`The manifest has a duplicate wear-layer path: ${item.wearLayerFile}`);
    }
    referencedPaths.add(item.wearLayerFile);
    item.images.forEach((image) => {
      if (referencedPaths.has(image.file)) throw new Error(`The manifest has a duplicate asset path: ${image.file}`);
      referencedPaths.add(image.file);
    });
  }

  for (const item of manifest.items) {
    const wearLayer = filesByPath.get(item.wearLayerFile);
    if (!wearLayer) throw new Error(`Missing wear layer for ${item.name}: ${item.wearLayerFile}`);
    if (extension(item.wearLayerFile) !== "png" || (wearLayer.type && wearLayer.type !== "image/png")) {
      throw new Error(`Wear layer ${item.wearLayerFile} must be a PNG derivative.`);
    }
    for (const image of item.images) {
      if (!filesByPath.has(image.file)) throw new Error(`Missing product image derivative: ${image.file}`);
    }
  }

  for (const path of filesByPath.keys()) {
    if (referencedPaths.has(path)) continue;
    if (RAW_SOURCE_EXTENSIONS.has(extension(path))) {
      throw new Error(`Raw source files are refused: ${path}`);
    }
    const kind = path.endsWith("/wear-layer.png")
      ? "wear layer"
      : path.includes("/images/") ? "product image" : "file";
    throw new Error(`Unreferenced ${kind} in bundle: ${path}`);
  }

  const objectUrls = [];
  try {
    const items = manifest.items.map((manifestItem) => {
      const wearLayerFile = filesByPath.get(manifestItem.wearLayerFile);
      const cutoutUrl = URL.createObjectURL(wearLayerFile);
      objectUrls.push(cutoutUrl);
      return {
        manifestItem: {
          version: 2,
          id: manifestItem.id,
          name: manifestItem.name,
          category: manifestItem.category,
          slot: manifestItem.slot,
          colors: manifestItem.colors ?? [],
          tags: manifestItem.tags ?? [],
          images: manifestItem.images.map((image) => ({
            id: image.id,
            view: image.view,
            sortOrder: image.sortOrder,
            isPrimary: image.isPrimary,
          })),
        },
        cutoutFile: wearLayerFile,
        detailFiles: [],
        imageFiles: manifestItem.images.map((image) => ({
          id: image.id,
          view: image.view,
          sortOrder: image.sortOrder,
          isPrimary: image.isPrimary,
          file: filesByPath.get(image.file),
        })),
        cutoutUrl,
        placement: { ...manifestItem.placement },
      };
    });
    return withCleanup(items, objectUrls);
  } catch (error) {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
}

function withCleanup(items, objectUrls) {
  let cleanedUp = false;
  return {
    items,
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    },
  };
}

export async function parseImportBundle(fileList) {
  const files = Array.from(fileList || []);
  const manifestCandidates = files.filter((file) => selectedPath(file).split("/").at(-1) === "manifest.json");
  if (manifestCandidates.length !== 1) {
    throw new Error("Select a bundle containing exactly one manifest.json.");
  }

  const manifestFile = manifestCandidates[0];
  const selectedManifestPath = selectedPath(manifestFile);
  const manifestDirectory = selectedManifestPath.slice(0, selectedManifestPath.length - "manifest.json".length);
  let manifest;
  try {
    manifest = JSON.parse(await manifestFile.text());
  } catch {
    throw new Error("manifest.json is not valid JSON.");
  }
  if (!manifest || typeof manifest !== "object" || (manifest.version !== 1 && manifest.version !== 2)) {
    throw new Error("The import bundle must use manifest version 1 or 2.");
  }
  if (!Array.isArray(manifest.items)) throw new Error("manifest.json must contain an items array.");

  const filesByPath = new Map();
  for (const file of files) {
    const path = relativeBundlePath(file, manifestDirectory);
    if (filesByPath.has(path)) throw new Error(`The bundle has a duplicate path: ${path}`);
    filesByPath.set(path, file);
  }

  return manifest.version === 2
    ? buildBundleV2(manifest, filesByPath)
    : buildBundleV1(manifest, filesByPath);
}
