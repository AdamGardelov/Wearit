import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { prepareImportBundle } from "../prepare-import-bundle.mjs";
import { CATEGORY_BY_ID, CATEGORY_BY_SOURCE_FOLDER, slotForCategory, defaultLayerOrderForCategory } from "../../src/domain/slots.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const BYTE_FIELDS = ["wearLayers", "productImages", "manifest", "total"];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isContained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireMetadata(item) {
  const metadata = item.metadata;
  if (!isPlainObject(metadata)) {
    throw new Error(`Accepted item ${item.id} requires complete metadata`);
  }
  if (
    !Array.isArray(metadata.colors)
    || metadata.colors.length === 0
    || metadata.colors.some(
      (color) => typeof color !== "string" || !HEX_COLOR.test(color),
    )
  ) {
    throw new Error(`Accepted item ${item.id} has invalid metadata colors`);
  }
  if (
    !Array.isArray(metadata.tags)
    || metadata.tags.length > 12
    || metadata.tags.some((tag) => (
      typeof tag !== "string"
      || tag.length === 0
      || tag.length > 40
      || tag.trim() !== tag
      || tag.toLowerCase() !== tag
    ))
  ) {
    throw new Error(`Accepted item ${item.id} has invalid metadata tags`);
  }
  if (!UUID_V4.test(metadata.productImageId ?? "")) {
    throw new Error(`Accepted item ${item.id} has invalid metadata productImageId`);
  }
  return metadata;
}

function normalizedPlacement(item) {
  const candidate = isPlainObject(item.placement?.placement)
    ? item.placement.placement
    : item.placement;
  if (!isPlainObject(candidate)) {
    throw new Error(`Accepted item ${item.id} requires a selected placement`);
  }
  const fields = {
    anchorX: [0, 1, false],
    anchorY: [0, 1, false],
    scale: [0.05, 2, false],
    rotationDegrees: [-180, 180, false],
    layerOrder: [0, 100, true],
  };
  const placement = {};
  for (const [field, [minimum, maximum, integer]] of Object.entries(fields)) {
    const value = candidate[field];
    if (
      typeof value !== "number"
      || !Number.isFinite(value)
      || value < minimum
      || value > maximum
      || (integer && !Number.isInteger(value))
    ) {
      throw new Error(`Accepted item ${item.id} has invalid placement ${field}`);
    }
    placement[field] = value;
  }
  return placement;
}

function assetReference(state, item, kind) {
  const assetPath = item.acceptedAssets?.[kind]?.path;
  requireNonEmptyString(assetPath, `Accepted item ${item.id} ${kind} path`);
  const workspace = path.resolve(state.workspacePath ?? "");
  const absolute = path.isAbsolute(assetPath)
    ? path.resolve(assetPath)
    : path.resolve(workspace, assetPath);
  if (!isContained(workspace, absolute)) {
    throw new Error(`Accepted item ${item.id} ${kind} is outside the workspace`);
  }
  const relative = path.relative(workspace, absolute).split(path.sep).join("/");
  if (
    relative.length === 0
    || relative === ".."
    || relative.startsWith("../")
    || path.posix.normalize(relative) !== relative
  ) {
    throw new Error(`Accepted item ${item.id} ${kind} path is not canonical`);
  }
  return relative;
}

export function acceptedManifest(state) {
  if (!isPlainObject(state) || !Array.isArray(state.items) || ![3, 4].includes(state.version)) throw new Error("Finalization requires version-3 or version-4 batch state");
  if (state.version === 4) return acceptedManifestV4(state);
  requireNonEmptyString(state.workspacePath, "Batch workspacePath");
  const items = state.items
    .filter(({ status }) => status === "accepted")
    .map((item) => {
      if (!UUID_V4.test(item.id ?? "")) {
        throw new Error("Accepted item id must be a version-4 UUID");
      }
      const metadata = requireMetadata(item);
      if (item.category !== "jacket") {
        throw new Error(`Accepted item ${item.id} must use category jacket`);
      }
      return {
        id: item.id,
        name: requireNonEmptyString(item.name, `Accepted item ${item.id} name`),
        category: "jacket",
        wearLayerFile: assetReference(state, item, "wear-layer"),
        images: [{
          id: metadata.productImageId,
          file: assetReference(state, item, "product-image"),
          view: "front",
          sortOrder: 0,
          isPrimary: true,
        }],
        colors: [...metadata.colors],
        tags: [...metadata.tags],
        placement: normalizedPlacement(item),
        status: "accepted",
      };
    });
  return { version: 2, items };
}

function acceptedManifestV4(state) {
  requireNonEmptyString(state.workspacePath, "Batch workspacePath");
  const items = state.items.filter(({ status }) => status === "accepted").map((item) => {
    if (!UUID_V4.test(item.id ?? "")) throw new Error("Accepted item id must be a version-4 UUID");
    if (!CATEGORY_BY_ID[item.category] || item.category === "all") throw new Error("Accepted item " + item.id + " has invalid category");
    if (!isPlainObject(item.profile) || item.profile.category !== item.category || item.profile.relativePath !== "scripts/wearit-images/category-profiles.json" || !/^[0-9a-f]{64}$/.test(item.profile.sha256 ?? "")) throw new Error("Accepted item " + item.id + " has invalid category profile");
    const metadata = item.metadata;
    if (!isPlainObject(metadata) || !Array.isArray(metadata.images) || metadata.images.length === 0) throw new Error("Accepted item " + item.id + " requires complete image metadata");
    const images = metadata.images.map((image) => {
      if (!isPlainObject(image) || !UUID_V4.test(image.id ?? "") || !["front", "back", "detail"].includes(image.view)) throw new Error("Accepted item " + item.id + " has invalid product image metadata");
      const asset = item.acceptedAssets?.["product-image:" + image.id] ?? item.acceptedAssets?.[image.id];
      if (!asset) throw new Error("Accepted item " + item.id + " has no accepted product image " + image.id);
      return { id: image.id, file: assetReference(state, { ...item, acceptedAssets: { "product-image": asset } }, "product-image"), view: image.view, sortOrder: image.sortOrder, isPrimary: image.isPrimary };
    });
    if (!item.acceptedAssets?.["wear-layer"]) throw new Error("Accepted item " + item.id + " has no accepted wear layer");
    const placement = normalizedPlacement(item); placement.layerOrder = defaultLayerOrderForCategory(item.category);
    return { id: item.id, name: requireNonEmptyString(item.name, "Accepted item " + item.id + " name"), category: item.category, slot: slotForCategory(item.category), wearLayerFile: assetReference(state, item, "wear-layer"), images, colors: Array.isArray(metadata.colors) ? [...metadata.colors] : [], tags: Array.isArray(metadata.tags) ? [...metadata.tags] : [], placement, status: "accepted" };
  });
  return { version: 2, items };
}
export function processedDestination(sourcePath, expectedCategory = undefined) {
  requireNonEmptyString(sourcePath, "Source path");
  if (!path.isAbsolute(sourcePath) || path.normalize(sourcePath) !== sourcePath) {
    throw new Error(`Source path must be absolute and canonical: ${sourcePath}`);
  }
  const root = path.parse(sourcePath).root;
  const segments = sourcePath.slice(root.length).split(path.sep);
  const indexes = segments.flatMap((segment, index) =>
    segment === "unprocessed" ? [index] : []
  );
  if (indexes.length !== 1) {
    throw new Error(`Source path must contain exactly one unprocessed segment: ${sourcePath}`);
  }
  const index = indexes[0];
  const sourceFolder = segments[index + 1];
  const definition = CATEGORY_BY_SOURCE_FOLDER[sourceFolder];
  if (!definition || index + 2 >= segments.length) throw new Error(`Source path is outside unprocessed/<registered-category>: ${sourcePath}`);
  if (expectedCategory !== undefined && definition.id !== expectedCategory) throw new Error(`Source path category ${definition.id} does not match item category ${expectedCategory}: ${sourcePath}`);
  segments[index] = "processed";
  return path.join(root, ...segments);
}

async function existingPathInfo(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertRegularCanonicalFile(file, label) {
  const info = await lstat(file);
  if (info.isSymbolicLink()) throw new Error(`${label} is a symlink: ${file}`);
  if (!info.isFile()) throw new Error(`${label} is not a regular file: ${file}`);
  if (await realpath(file) !== file) {
    throw new Error(`${label} is noncanonical: ${file}`);
  }
}

async function hashFile(file) {
  const handle = await open(file, "r");
  try {
    const bytes = await readFile(handle);
    return {
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    await handle.close();
  }
}

async function canonicalProspective(candidate) {
  let ancestor = candidate;
  const missing = [];
  while (true) {
    try {
      const info = await lstat(ancestor);
      if (info.isSymbolicLink()) {
        throw new Error(`Path contains a symlink: ${ancestor}`);
      }
      if (!info.isDirectory()) {
        throw new Error(`Path ancestor is not a directory: ${ancestor}`);
      }
      const canonical = await realpath(ancestor);
      return path.join(canonical, ...missing.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.push(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

export async function preflightSourceMoves(state) {
  if (!isPlainObject(state) || !Array.isArray(state.items)) {
    throw new Error("Source preflight requires batch state items");
  }
  const input = path.resolve(requireNonEmptyString(state.inputPath, "Batch inputPath"));
  if (processedDestination(path.join(input, "source-check"))) {
    // processedDestination performs the expected-tree shape check.
  }
  const destinations = new Set();
  const moves = [];
  for (const item of state.items.filter(({ status }) => status === "accepted")) {
    if (!Array.isArray(item.sources) || item.sources.length === 0) {
      throw new Error(`Accepted item ${item.id} has no sources`);
    }
    for (let sourceIndex = 0; sourceIndex < item.sources.length; sourceIndex += 1) {
      const source = item.sources[sourceIndex];
      const original = source.originalPath ?? source.path;
      const destination = processedDestination(original, item.category);
      if (!isContained(input, original)) {
        throw new Error(`Accepted source is outside the expected input tree: ${original}`);
      }
      if (destinations.has(destination)) {
        throw new Error(`Duplicate processed destination: ${destination}`);
      }
      destinations.add(destination);
      const moved = source.originalPath !== undefined;
      if (moved) {
        if (source.path !== destination || !source.processedAt) {
          throw new Error(`Invalid persisted source move for ${original}`);
        }
        if (await existingPathInfo(original)) {
          throw new Error(`Persisted source move is ambiguous: ${original}`);
        }
        await assertRegularCanonicalFile(destination, "Processed destination");
      } else {
        if (source.path !== original) {
          throw new Error(`Accepted source path is ambiguous: ${source.path}`);
        }
        await assertRegularCanonicalFile(original, "Accepted source");
        const metadata = await hashFile(original);
        if (metadata.size !== source.size || metadata.sha256 !== source.sha256) {
          throw new Error(`Accepted source drift: ${original}`);
        }
        const existing = await existingPathInfo(destination);
        if (existing?.isSymbolicLink()) {
          throw new Error(`Processed destination is a symlink: ${destination}`);
        }
        if (existing) throw new Error(`Processed destination collision: ${destination}`);
        if (await canonicalProspective(path.dirname(destination)) !== path.dirname(destination)) {
          throw new Error(`Processed destination is noncanonical: ${destination}`);
        }
      }
      moves.push({ itemId: item.id, sourceIndex, original, destination, moved });
    }
  }
  return moves;
}

async function ensureCanonicalDirectory(directory) {
  const canonical = await canonicalProspective(directory);
  if (canonical !== directory) throw new Error(`Directory is noncanonical: ${directory}`);
  let ancestor = directory;
  const missing = [];
  while (!(await existingPathInfo(ancestor))) {
    missing.push(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  for (const segment of missing.reverse()) {
    ancestor = path.join(ancestor, segment);
    await mkdir(ancestor);
    const info = await lstat(ancestor);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(ancestor) !== ancestor) {
      throw new Error(`Unsafe destination directory: ${ancestor}`);
    }
  }
}

async function atomicWriteJson(file, value) {
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function errorRecord(error) {
  const record = {
    at: new Date().toISOString(),
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
  if (error instanceof Error && error.stack) record.stack = error.stack;
  return record;
}

async function persistInfrastructureStop(stateFile, state, error) {
  const failure = errorRecord(error);
  state.infrastructureErrors = [...(state.infrastructureErrors ?? []), failure];
  state.finalization = {
    status: "failed-infrastructure",
    cause: failure,
  };
  await atomicWriteJson(stateFile, state);
}

async function safeManagedPaths(state, stateFile, repositoryRoot, bundleDir) {
  const requestedRepo = path.resolve(repositoryRoot);
  const repoInfo = await lstat(requestedRepo);
  if (repoInfo.isSymbolicLink() || !repoInfo.isDirectory() || await realpath(requestedRepo) !== requestedRepo) {
    throw new Error(`Repository root is unsafe or noncanonical: ${requestedRepo}`);
  }
  const workspace = path.resolve(state.workspacePath ?? "");
  if (workspace !== path.dirname(path.resolve(stateFile))) {
    throw new Error("State file must be directly inside the managed workspace");
  }
  const workspaceInfo = await lstat(workspace);
  if (workspaceInfo.isSymbolicLink() || !workspaceInfo.isDirectory() || await realpath(workspace) !== workspace) {
    throw new Error(`Workspace is unsafe or noncanonical: ${workspace}`);
  }
  if (!isContained(requestedRepo, workspace)) {
    throw new Error("Managed workspace must be inside the repository root");
  }
  await assertRegularCanonicalFile(path.resolve(stateFile), "State file");
  const input = path.resolve(state.inputPath ?? "");
  const inputInfo = await lstat(input);
  if (inputInfo.isSymbolicLink() || !inputInfo.isDirectory() || await realpath(input) !== input) {
    throw new Error(`Input directory is unsafe or noncanonical: ${input}`);
  }
  const bundle = path.resolve(bundleDir);
  if (
    bundle === requestedRepo
    || !isContained(requestedRepo, bundle)
    || isContained(workspace, bundle)
    || isContained(bundle, workspace)
    || isContained(input, bundle)
    || isContained(bundle, input)
  ) {
    throw new Error("Bundle path must be inside the repository and not overlap input or workspace");
  }
  if (await canonicalProspective(bundle) !== bundle) {
    throw new Error(`Bundle path is unsafe or noncanonical: ${bundle}`);
  }
  return { repositoryRoot: requestedRepo, workspace, input, bundle };
}

function validateFinalBundle(result, accepted) {
  if (!isPlainObject(result) || result.changed !== false || result.accepted !== accepted) {
    throw new Error("Final bundle dry-run must be unchanged and include every accepted item");
  }
  if (
    !isPlainObject(result.bytes)
    || BYTE_FIELDS.some(
      (field) => !Number.isSafeInteger(result.bytes[field]) || result.bytes[field] < 0,
    )
    || result.bytes.total !== (
      result.bytes.wearLayers + result.bytes.productImages + result.bytes.manifest
    )
  ) {
    throw new Error("Final bundle result must include valid byte totals");
  }
}

async function moveSource(move, state, stateFile) {
  await ensureCanonicalDirectory(path.dirname(move.destination));
  if (await existingPathInfo(move.destination)) {
    throw new Error(`Processed destination collision: ${move.destination}`);
  }
  await copyFile(move.original, move.destination, constants.COPYFILE_EXCL);
  try {
    const item = state.items.find(({ id }) => id === move.itemId);
    const source = item?.sources?.[move.sourceIndex];
    const copied = await hashFile(move.destination);
    if (!source || copied.size !== source.size || copied.sha256 !== source.sha256) {
      throw new Error(`Copied source verification failed: ${move.original}`);
    }
    await unlink(move.original);
  } catch (error) {
    await unlink(move.destination).catch(() => {});
    throw error;
  }
  const source = state.items
    .find(({ id }) => id === move.itemId)
    .sources[move.sourceIndex];
  state.items
    .find(({ id }) => id === move.itemId)
    .sources[move.sourceIndex] = {
      ...source,
      originalPath: move.original,
      path: move.destination,
      processedAt: new Date().toISOString(),
    };
  await atomicWriteJson(stateFile, state);
}

export async function finalizeBatch({
  stateFile,
  repositoryRoot,
  bundleDir,
  prepareBundle = prepareImportBundle,
}) {
  if (!stateFile || !repositoryRoot || !bundleDir || typeof prepareBundle !== "function") {
    throw new Error("stateFile, repositoryRoot, bundleDir, and prepareBundle are required");
  }
  const statePath = path.resolve(stateFile);
  const state = JSON.parse(await readFile(statePath, "utf8"));
  try {
    const paths = await safeManagedPaths(
      state,
      statePath,
      repositoryRoot,
      bundleDir,
    );
    const manifest = acceptedManifest(state);
    const manifestFile = path.join(paths.workspace, "reviewed-items.v2.json");
    const manifestInfo = await existingPathInfo(manifestFile);
    if (manifestInfo?.isSymbolicLink() || (manifestInfo && !manifestInfo.isFile())) {
      throw new Error(`Reviewed manifest path is unsafe: ${manifestFile}`);
    }
    await atomicWriteJson(manifestFile, manifest);
    const bundleOptions = {
      itemsDir: paths.workspace,
      manifestFile,
      outputDir: paths.bundle,
    };
    await prepareBundle({ ...bundleOptions, dryRun: true });
    await prepareBundle({ ...bundleOptions, dryRun: false });
    const verified = await prepareBundle({ ...bundleOptions, dryRun: true });
    validateFinalBundle(verified, manifest.items.length);

    const moves = await preflightSourceMoves(state);
    for (const move of moves) {
      if (!move.moved) await moveSource(move, state, statePath);
    }
    state.finalization = {
      status: "finalized",
      manifestFile,
      bundleDir: paths.bundle,
      accepted: manifest.items.length,
      bytes: verified.bytes,
      completedAt: new Date().toISOString(),
    };
    await atomicWriteJson(statePath, state);
    return { ...verified, outputDir: paths.bundle };
  } catch (error) {
    await persistInfrastructureStop(statePath, state, error);
    throw error;
  }
}
