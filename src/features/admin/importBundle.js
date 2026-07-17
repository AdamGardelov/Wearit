const RAW_SOURCE_EXTENSIONS = new Set(["jpg", "jpeg", "heic", "heif", "tif", "tiff"]);
const DETAIL_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
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
  if (!manifest || typeof manifest !== "object" || manifest.version !== 1) {
    throw new Error("The import bundle must use manifest version 1.");
  }
  if (!Array.isArray(manifest.items)) throw new Error("manifest.json must contain an items array.");

  const filesByPath = new Map();
  for (const file of files) {
    const path = relativeBundlePath(file, manifestDirectory);
    if (filesByPath.has(path)) throw new Error(`The bundle has a duplicate path: ${path}`);
    filesByPath.set(path, file);
  }

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
        cutoutUrl,
        placement: { ...manifestItem.placement },
      };
    });
    let cleanedUp = false;
    return {
      items,
      cleanup() {
        if (cleanedUp) return;
        cleanedUp = true;
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
      },
    };
  } catch (error) {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
}
