import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { categoryForSourceFolder, CATEGORY_DEFINITIONS } from "../../src/domain/slots.js";
import { loadProfiles, profileForCategory } from "./profiles.mjs";

const STATE_VERSION = 4;
const LEGACY_STATE_VERSION = 3;
const TERMINAL_ITEM_STATUSES = new Set([
  "accepted",
  "quarantined",
  "failed-infrastructure",
]);
const ITEM_STATUSES = new Set([
  "ready",
  "generating",
  "processing",
  "placing",
  "reviewing",
  "accepted",
  "quarantined",
  "failed-infrastructure",
]);
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 10_000;
const LOCK_RETRY_MS = 25;
const POLICY_KEYS = [
  "acceptanceConfidence",
  "auditRate",
  "maxGenerationAttempts",
  "reuseEarlierOutput",
];
const BATCH_DIRECTORIES = [
  "accepted/product-images",
  "accepted/wear-layers",
  "accepted/mannequin-previews",
  "quarantine",
  "audit/contact-sheets",
  "attempts",
  "reports",
];
const MANAGED_ROOTS = new Set(
  BATCH_DIRECTORIES.map((directory) => directory.split("/")[0]),
);
const INTERNAL_TOMBSTONE_NAME = /^run-state\.json\.lock\.reaper(?:\.guard)?\.tombstone\.[1-9]\d*\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isContained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (
    !relative.startsWith(`..${path.sep}`)
    && relative !== ".."
    && !path.isAbsolute(relative)
  );
}

function validateIntakeFilename(file) {
  if (typeof file !== "string" || file.length === 0) {
    throw new Error("Intake source filename must be a non-empty string");
  }
  if (path.isAbsolute(file) || path.win32.isAbsolute(file)) {
    throw new Error(`Absolute intake filename is not allowed: ${file}`);
  }
}

function isPlainObject(value) {
  return (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value) {
  return (
    typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
  );
}

const IMAGE_VIEWS = new Set(["front", "back", "detail"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function validateV3ItemMetadata(metadata, slug, stateFile) {
  if (!isPlainObject(metadata)) {
    throw stateError(stateFile, `invalid metadata for ${slug}`);
  }
  const expectedKeys = ["colors", "productImageId", "tags"];
  if (Object.keys(metadata).sort().join(",") !== expectedKeys.join(",")) {
    throw stateError(stateFile, `invalid metadata shape for ${slug}`);
  }
  if (
    !Array.isArray(metadata.colors)
    || metadata.colors.length === 0
    || metadata.colors.some(
      (color) => typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color),
    )
  ) {
    throw stateError(stateFile, `invalid metadata colors for ${slug}`);
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
    throw stateError(stateFile, `invalid metadata tags for ${slug}`);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(metadata.productImageId ?? "")) {
    throw stateError(stateFile, `invalid metadata productImageId for ${slug}`);
  }
}

function validateV4ItemMetadata(metadata, slug, stateFile) {
  if (!isPlainObject(metadata) || Object.keys(metadata).join(",") !== "images") throw stateError(stateFile, `invalid metadata shape for ${slug}`);
  if (!Array.isArray(metadata.images) || metadata.images.length === 0) throw stateError(stateFile, `invalid metadata images for ${slug}`);
  const ids = new Set(); const orders = new Set(); let primaryFronts = 0; let backs = 0;
  for (const image of metadata.images) {
    if (!isPlainObject(image) || Object.keys(image).sort().join(",") !== "id,isPrimary,sortOrder,view") throw stateError(stateFile, `invalid metadata image shape for ${slug}`);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(image.id ?? "") || ids.has(image.id) || !IMAGE_VIEWS.has(image.view)) throw stateError(stateFile, `invalid metadata image identity for ${slug}`);
    if (!Number.isSafeInteger(image.sortOrder) || image.sortOrder < 0 || orders.has(image.sortOrder)) throw stateError(stateFile, `invalid metadata image sortOrder for ${slug}`);
    if (typeof image.isPrimary !== "boolean") throw stateError(stateFile, `invalid metadata image primary flag for ${slug}`);
    ids.add(image.id); orders.add(image.sortOrder); if (image.view === "back") backs += 1;
    if (image.isPrimary && image.view === "front") primaryFronts += 1;
    if (image.isPrimary && image.view !== "front") throw stateError(stateFile, `only front image may be primary for ${slug}`);
  }
  if (primaryFronts !== 1 || backs > 1) throw stateError(stateFile, `metadata images require exactly one primary front and at most one back for ${slug}`);
}

function validateProductImages(productImages, slug, stateFile) {
  if (!Array.isArray(productImages) || productImages.some((image) => !isPlainObject(image))) throw stateError(stateFile, `invalid productImages for ${slug}`);
}

function stateError(stateFile, reason, cause) {
  return new Error(`Invalid batch state at ${stateFile}: ${reason}`, {
    cause,
  });
}

async function canonicalStatePath(value, field, stateFile) {
  try {
    return await realpath(value);
  } catch (error) {
    throw stateError(
      stateFile,
      `${field} cannot be resolved canonically: ${value}`,
      error,
    );
  }
}

function sourceLabel(inputPath, sourcePath) {
  const relative = path.relative(inputPath, sourcePath);
  return relative && !relative.startsWith("..")
    ? relative
    : path.basename(sourcePath);
}

function sameFileStat(before, after) {
  return (
    before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeNs === after.mtimeNs
    && before.ctimeNs === after.ctimeNs
  );
}

async function hashStableFile(file) {
  const handle = await open(file, "r");
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw new Error(`Source is not a regular file: ${file}`);
    }

    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
    }

    const after = await handle.stat({ bigint: true });
    if (!sameFileStat(before, after)) {
      throw new Error(`Source changed while hashing: ${file}`);
    }
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Source is too large to represent safely: ${file}`);
    }

    return {
      size: Number(before.size),
      sha256: hash.digest("hex"),
    };
  } finally {
    await handle.close();
  }
}

async function ensureWorkspaceDirectory(workspacePath, relativePath) {
  let currentPath = workspacePath;

  for (const segment of relativePath.split("/")) {
    currentPath = path.join(currentPath, segment);
    try {
      const currentStat = await lstat(currentPath);
      if (currentStat.isSymbolicLink()) {
        throw new Error(`Workspace path contains a symlink: ${currentPath}`);
      }
      if (!currentStat.isDirectory()) {
        throw new Error(`Workspace path is not a directory: ${currentPath}`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      await mkdir(currentPath);
    }

    const canonicalPath = await realpath(currentPath);
    if (!isContained(workspacePath, canonicalPath)) {
      throw new Error(`Workspace directory escapes workspace: ${currentPath}`);
    }
  }
}

async function validateBatchState(state, stateFile) {
  if (!isPlainObject(state) || ![LEGACY_STATE_VERSION, STATE_VERSION].includes(state.version)) {
    throw stateError(stateFile, `version must be ${STATE_VERSION} or ${LEGACY_STATE_VERSION}`);
  }
  if (!isNonEmptyString(state.batchSlug)) {
    throw stateError(stateFile, "batchSlug must be a non-empty string");
  }
  if (!path.isAbsolute(state.inputPath ?? "")) {
    throw stateError(stateFile, "inputPath must be absolute");
  }
  if (!path.isAbsolute(state.workspacePath ?? "")) {
    throw stateError(stateFile, "workspacePath must be absolute");
  }
  if (!isTimestamp(state.createdAt) || !isTimestamp(state.updatedAt)) {
    throw stateError(stateFile, "createdAt and updatedAt must be ISO timestamps");
  }
  if (state.stage !== "processing") {
    throw stateError(stateFile, "stage must be processing");
  }
  if (!isPlainObject(state.policy)) {
    throw stateError(stateFile, "policy must be an object");
  }
  if (
    state.version === LEGACY_STATE_VERSION && Object.keys(state.policy).sort().join(",") !== [...POLICY_KEYS, "category"].sort().join(",")
    || state.version === STATE_VERSION && Object.keys(state.policy).sort().join(",") !== POLICY_KEYS.sort().join(",")
    || (state.version === LEGACY_STATE_VERSION && state.policy.category !== "Jackets")
    || state.policy.maxGenerationAttempts !== 3
    || state.policy.acceptanceConfidence !== 0.9
    || state.policy.auditRate !== 0.1
    || state.policy.reuseEarlierOutput !== false
  ) {
    throw stateError(
      stateFile,
      "policy must match the bounded processing policy",
    );
  }
  if (!Array.isArray(state.items)) {
    throw stateError(stateFile, "items must be an array");
  }
  if (!Array.isArray(state.infrastructureErrors)) {
    throw stateError(stateFile, "infrastructureErrors must be an array");
  }

  const canonicalInput = await canonicalStatePath(
    state.inputPath,
    "inputPath",
    stateFile,
  );
  if (canonicalInput !== state.inputPath) {
    throw stateError(stateFile, "inputPath must be canonical");
  }
  if (state.version === LEGACY_STATE_VERSION && path.basename(canonicalInput) !== "Jackets") {
    throw stateError(stateFile, "inputPath must identify the Jackets category");
  }
  const canonicalWorkspace = await canonicalStatePath(
    state.workspacePath,
    "workspacePath",
    stateFile,
  );
  if (canonicalWorkspace !== state.workspacePath) {
    throw stateError(stateFile, "workspacePath must be canonical");
  }
  const stateDirectory = await realpath(path.dirname(path.resolve(stateFile)));
  if (canonicalWorkspace !== stateDirectory) {
    throw stateError(
      stateFile,
      "workspacePath must be the canonical parent of run-state.json",
    );
  }
  if (
    isContained(canonicalInput, canonicalWorkspace)
    || isContained(canonicalWorkspace, canonicalInput)
  ) {
    throw stateError(stateFile, "input and workspace trees overlap");
  }

  for (const failure of state.infrastructureErrors) {
    if (
      !isPlainObject(failure)
      || !isTimestamp(failure.at)
      || !isNonEmptyString(failure.name)
      || !isNonEmptyString(failure.message)
      || (
        failure.stack !== undefined
        && typeof failure.stack !== "string"
      )
    ) {
      throw stateError(stateFile, "invalid infrastructure error entry");
    }
  }

  const ids = new Set();
  const slugs = new Set();
  const sourcePaths = new Set();

  for (const item of state.items) {
    if (!isPlainObject(item)) {
      throw stateError(stateFile, "every item must be an object");
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id ?? "")) {
      throw stateError(stateFile, "item id must be a version-4 UUID");
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug ?? "")) {
      throw stateError(stateFile, `invalid item slug: ${item.slug}`);
    }
    if (!isNonEmptyString(item.name)) {
      throw stateError(stateFile, `invalid item name: ${item.slug}`);
    }
    if (state.version === LEGACY_STATE_VERSION && item.category !== "jacket") {
      throw stateError(stateFile, `invalid item category: ${item.slug}`);
    }
    if (state.version === STATE_VERSION) {
      const definition = CATEGORY_DEFINITIONS.find(({ id }) => id === item.category);
      if (!definition || !isPlainObject(item.profile) || item.profile.category !== item.category || item.profile.relativePath !== "scripts/wearit-images/category-profiles.json" || !/^[a-f0-9]{64}$/.test(item.profile.sha256 ?? "")) {
        throw stateError(stateFile, `invalid category profile: ${item.slug}`);
      }
    }
    if (!ITEM_STATUSES.has(item.status)) {
      throw stateError(stateFile, `invalid item status: ${item.slug}`);
    }
    if (
      !Number.isInteger(item.generationAttempts)
      || item.generationAttempts < 0
      || item.generationAttempts > state.policy.maxGenerationAttempts
    ) {
      throw stateError(
        stateFile,
        `invalid generationAttempts for ${item.slug}`,
      );
    }
    if (!isPlainObject(item.acceptedAssets)) {
      throw stateError(stateFile, `invalid acceptedAssets for ${item.slug}`);
    }
    if (state.version === LEGACY_STATE_VERSION) {
      if (item.metadata !== undefined) validateV3ItemMetadata(item.metadata, item.slug, stateFile);
    } else {
      validateV4ItemMetadata(item.metadata, item.slug, stateFile);
      validateProductImages(item.productImages, item.slug, stateFile);
    }
    if (
      !Array.isArray(item.attempts)
      || item.attempts.some((attempt) => !isPlainObject(attempt))
    ) {
      throw stateError(stateFile, `invalid attempts for ${item.slug}`);
    }
    for (const [field, value] of [
      ["placement", item.placement],
      ["review", item.review],
      ["quarantine", item.quarantine],
    ]) {
      if (value !== null && !isPlainObject(value)) {
        throw stateError(stateFile, `invalid ${field} for ${item.slug}`);
      }
    }
    if (!Array.isArray(item.sources) || item.sources.length === 0) {
      throw stateError(stateFile, `item sources are required: ${item.slug}`);
    }
    if (ids.has(item.id)) {
      throw stateError(stateFile, `duplicate id: ${item.id}`);
    }
    ids.add(item.id);

    if (slugs.has(item.slug)) {
      throw stateError(stateFile, `duplicate slug: ${item.slug}`);
    }
    slugs.add(item.slug);

    for (const source of item.sources) {
      if (typeof source?.path !== "string" || !path.isAbsolute(source.path)) {
        throw stateError(stateFile, `invalid source path for ${item.slug}`);
      }
      if (!isNonEmptyString(source.role)) {
        throw stateError(stateFile, `invalid source role for ${item.slug}`);
      }
      if (!Number.isSafeInteger(source.size) || source.size < 0) {
        throw stateError(stateFile, `invalid source size for ${item.slug}`);
      }
      if (!/^[a-f0-9]{64}$/.test(source.sha256 ?? "")) {
        throw stateError(stateFile, `invalid source sha256 for ${item.slug}`);
      }

      let canonicalSource;
      try {
        canonicalSource = await realpath(source.path);
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw stateError(
            stateFile,
            `source drift for ${sourceLabel(canonicalInput, source.path)}: source is missing`,
            error,
          );
        }
        throw stateError(
          stateFile,
          `cannot resolve source ${source.path}: ${error.message}`,
          error,
        );
      }

      if (canonicalSource !== source.path) {
        throw stateError(stateFile, `source path is not canonical: ${source.path}`);
      }
      if (!isContained(canonicalInput, canonicalSource)) {
        throw stateError(
          stateFile,
          `source is outside canonical input directory: ${source.path}`,
        );
      }
      if (sourcePaths.has(canonicalSource)) {
        throw stateError(
          stateFile,
          `duplicate source membership: ${source.path}`,
        );
      }
      sourcePaths.add(canonicalSource);
    }
  }
}

async function canonicalizeProspectivePath(requestedPath) {
  let existingAncestor = path.resolve(requestedPath);
  const missingSegments = [];

  while (true) {
    try {
      const canonicalAncestor = await realpath(existingAncestor);
      return path.join(canonicalAncestor, ...missingSegments.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) throw error;
      missingSegments.push(path.basename(existingAncestor));
      existingAncestor = parent;
    }
  }
}

async function findManagedArtifact(directory, relative = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryRelative = path.join(relative, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      return (
        await findManagedArtifact(
          path.join(directory, entry.name),
          entryRelative,
        )
      ) ?? entryRelative;
    }
    return entryRelative;
  }
  return null;
}

async function assertFreshWorkspace(workspacePath, stateFile) {
  const lockName = path.basename(`${stateFile}.lock`);

  for (const entry of await readdir(workspacePath, { withFileTypes: true })) {
    if (entry.name === lockName && entry.isDirectory()) continue;
    if (entry.name === "intake.json" && entry.isFile()) continue;
    if (
      entry.isDirectory()
      && INTERNAL_TOMBSTONE_NAME.test(entry.name)
    ) {
      continue;
    }

    if (MANAGED_ROOTS.has(entry.name)) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error(
          `Fresh workspace contains managed output symlink or file: ${entry.name}`,
        );
      }
      const artifact = await findManagedArtifact(
        path.join(workspacePath, entry.name),
        entry.name,
      );
      if (artifact) {
        throw new Error(`Fresh workspace contains stale output: ${artifact}`);
      }
      continue;
    }

    throw new Error(`Fresh workspace contains unexpected output: ${entry.name}`);
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

async function readLockOwnerState(lockPath) {
  try {
    let owner;
    try {
      owner = JSON.parse(
        await readFile(path.join(lockPath, "owner.json"), "utf8"),
      );
    } catch (error) {
      if (error?.code === "ENOENT") return { kind: "missing" };
      if (error instanceof SyntaxError) return { kind: "malformed" };
      throw error;
    }

    if (
      Number.isInteger(owner.pid)
      && isNonEmptyString(owner.token)
      && Number.isFinite(owner.createdAtMs)
    ) {
      return { kind: "valid", owner };
    }
    return { kind: "malformed" };
  } catch (error) {
    if (error?.code === "ENOENT") return { kind: "missing" };
    throw error;
  }
}

async function snapshotLock(lockPath) {
  let lockStat;
  try {
    lockStat = await lstat(lockPath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!lockStat.isDirectory()) {
    throw new Error(`State lock is not a directory: ${lockPath}`);
  }

  return {
    dev: lockStat.dev,
    ino: lockStat.ino,
    modifiedAtMs: Number(lockStat.mtimeMs),
    ownerState: await readLockOwnerState(lockPath),
  };
}

function sameLockIdentity(first, second) {
  return (
    first !== null
    && second !== null
    && first.dev === second.dev
    && first.ino === second.ino
  );
}

function lockIsRecoverable(snapshot) {
  if (!snapshot) return false;
  const owner = snapshot.ownerState.kind === "valid"
    ? snapshot.ownerState.owner
    : null;
  const ageMs = Date.now() - (owner?.createdAtMs ?? snapshot.modifiedAtMs);
  if (
    ageMs < LOCK_STALE_MS
    || (owner && processIsAlive(owner.pid))
  ) {
    return false;
  }
  return true;
}

async function createOwnedLockDirectory(lockPath) {
  await mkdir(lockPath);
  const owner = {
    pid: process.pid,
    token: randomUUID(),
    createdAtMs: Date.now(),
  };
  try {
    await writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify(owner),
      { flag: "wx" },
    );
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true });
    throw error;
  }
  return owner;
}

async function releaseOwnedLockDirectory(lockPath, owner) {
  const currentOwnerState = await readLockOwnerState(lockPath);
  if (
    currentOwnerState.kind !== "valid"
    || currentOwnerState.owner.token !== owner.token
  ) {
    throw new Error(`State lock ownership changed: ${lockPath}`);
  }
  await rm(lockPath, { recursive: true });
}

async function recoverStaleLock(lockPath, reaperPath) {
  const observed = await snapshotLock(lockPath);
  if (!lockIsRecoverable(observed)) return false;

  let reaperOwner;
  try {
    reaperOwner = await createOwnedLockDirectory(reaperPath);
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }

  try {
    const confirmed = await snapshotLock(lockPath);
    if (
      !sameLockIdentity(observed, confirmed)
      || !lockIsRecoverable(confirmed)
    ) {
      return false;
    }
    await rm(lockPath, { recursive: true });
    return true;
  } finally {
    await releaseOwnedLockDirectory(reaperPath, reaperOwner);
  }
}

async function restoreTombstone(lockPath, tombstonePath) {
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `Lock recovery race preserved moved lock at ${tombstonePath}`,
      );
    }
    throw error;
  }

  try {
    await rename(tombstonePath, lockPath);
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true });
    throw error;
  }
}

async function recoverStaleAuxiliaryLock(lockPath) {
  const observed = await snapshotLock(lockPath);
  if (!lockIsRecoverable(observed)) return false;

  const tombstonePath = `${lockPath}.tombstone.${process.pid}.${randomUUID()}`;
  try {
    await rename(lockPath, tombstonePath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }

  const moved = await snapshotLock(tombstonePath);
  if (
    sameLockIdentity(observed, moved)
    && lockIsRecoverable(moved)
  ) {
    await rm(tombstonePath, { recursive: true });
    return true;
  }

  await restoreTombstone(lockPath, tombstonePath);
  return false;
}

async function lockPathExists(lockPath) {
  try {
    await lstat(lockPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireStateLock(stateFile) {
  const lockPath = `${stateFile}.lock`;
  const reaperPath = `${lockPath}.reaper`;
  const deadline = Date.now() + LOCK_WAIT_MS;

  while (true) {
    const guardPath = `${reaperPath}.guard`;
    await recoverStaleAuxiliaryLock(guardPath);
    const guardPresent = await lockPathExists(guardPath);
    if (!guardPresent && await recoverStaleAuxiliaryLock(reaperPath)) continue;

    const reaperPresent = (
      guardPresent
      || await lockPathExists(reaperPath)
    );

    if (!reaperPresent) {
      try {
        const owner = await createOwnedLockDirectory(lockPath);

        return async () => {
          await releaseOwnedLockDirectory(lockPath, owner);
        };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }

    if (await recoverStaleLock(lockPath, reaperPath)) continue;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      const ownerState = await readLockOwnerState(lockPath);
      const owner = ownerState.kind === "valid" ? ownerState.owner : null;
      throw new Error(
        `Timed out waiting for state lock ${lockPath}`
        + (owner ? ` held by live or unconfirmed pid ${owner.pid}` : ""),
      );
    }
    await delay(Math.min(LOCK_RETRY_MS, remaining));
  }
}

async function withStateLock(stateFile, operation) {
  const release = await acquireStateLock(stateFile);
  try {
    return await operation();
  } finally {
    await release();
  }
}

async function atomicWriteJson(file, value) {
  await validateBatchState(value, file);
  const directory = path.dirname(file);
  const temporaryFile = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
    });
    await rename(temporaryFile, file);
  } catch (error) {
    await unlink(temporaryFile).catch(() => {});
    throw error;
  }
}

async function sourceMetadata(inputPath, source, claimedSources) {
  validateIntakeFilename(source?.file);

  const requestedPath = path.resolve(inputPath, source.file);
  if (!isContained(inputPath, requestedPath)) {
    throw new Error(`Intake filename escapes input directory: ${source.file}`);
  }

  const extension = path.extname(requestedPath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) throw new Error(`Unsupported image format: ${source.file}`);

  const sourcePath = await realpath(requestedPath);
  if (!isContained(inputPath, sourcePath)) {
    throw new Error(`Source is outside canonical input directory: ${source.file}`);
  }
  if (claimedSources.has(sourcePath)) {
    throw new Error(`Duplicate source membership: ${source.file}`);
  }

  claimedSources.add(sourcePath);
  const metadata = await hashStableFile(sourcePath);
  return {
    path: sourcePath,
    role: source.role,
    ...metadata,
  };
}

async function validateResumeSources(state, stateFile) {
  for (const item of state.items) {
    for (const source of item.sources) {
      const displayName = sourceLabel(state.inputPath, source.path);
      try {
        const current = await hashStableFile(source.path);
        if (current.size !== source.size) {
          throw new Error("size changed");
        }
        if (current.sha256 !== source.sha256) {
          throw new Error("content hash changed");
        }
      } catch (error) {
        throw new Error(
          `Source drift in ${stateFile} for ${displayName}: ${error.message}`,
          {
          cause: error,
          },
        );
      }
    }
  }
}

export async function initializeBatch({
  inputDir,
  workspaceDir,
  batchSlug,
  intake,
  now = new Date().toISOString(),
}) {
  const inputPath = await realpath(inputDir);
  const sourceFolder = path.basename(inputPath);
  const rootCategory = categoryForSourceFolder(sourceFolder);
  const mixedRoot = sourceFolder === "unprocessed";
  if (!rootCategory && !mixedRoot) throw new Error(`Input must be a registered category folder or unprocessed: ${inputPath}`);

  const prospectiveWorkspace = await canonicalizeProspectivePath(workspaceDir);
  if (
    isContained(inputPath, prospectiveWorkspace)
    || isContained(prospectiveWorkspace, inputPath)
  ) {
    throw new Error("Input and workspace trees overlap");
  }

  await mkdir(workspaceDir, { recursive: true });
  const workspacePath = await realpath(workspaceDir);
  if (
    isContained(inputPath, workspacePath)
    || isContained(workspacePath, inputPath)
  ) {
    throw new Error("Input and workspace trees overlap");
  }
  const stateFile = path.join(workspacePath, "run-state.json");

  return withStateLock(stateFile, async () => {
    let stateExists = true;
    try {
      await stat(stateFile);
    } catch (error) {
      if (error?.code === "ENOENT") {
        stateExists = false;
      } else {
        throw error;
      }
    }

    if (stateExists) {
      const existingState = await loadBatch(stateFile);
      if (existingState.inputPath !== inputPath) {
        throw new Error(
          "Existing batch input path does not match requested input",
        );
      }
      if (existingState.workspacePath !== workspacePath) {
        throw new Error("Existing batch workspace path is invalid");
      }
      if (existingState.batchSlug !== batchSlug) {
        throw new Error("Existing batch slug does not match requested batch");
      }
      await validateResumeSources(existingState, stateFile);
      return existingState;
    }

    await assertFreshWorkspace(workspacePath, stateFile);
    if (!Array.isArray(intake)) {
      throw new Error("Batch intake must be an array");
    }

    const ids = new Set();
    const slugs = new Set();
    const claimedSources = new Set();
    const items = [];

    for (const item of intake) {
      if (ids.has(item.id)) {
        throw new Error(`Duplicate id: ${item.id}`);
      }
      if (slugs.has(item.slug)) {
        throw new Error(`Duplicate slug: ${item.slug}`);
      }
      if (!Array.isArray(item.sources) || item.sources.length === 0) {
        throw new Error(`Item must have at least one source: ${item.slug}`);
      }

      ids.add(item.id);
      slugs.add(item.slug);

      const category = item.category ?? rootCategory;
      const sources = [];
      for (const source of item.sources) {
        if (mixedRoot) {
          const firstSegment = String(source?.file ?? "").split(/[\\/]/)[0];
          const sourceCategory = categoryForSourceFolder(firstSegment);
          if (!sourceCategory) throw new Error(`Unknown category folder in mixed input: ${firstSegment}. Valid folders: ${CATEGORY_DEFINITIONS.map(({ sourceFolder }) => sourceFolder).join(", ")}`);
          if (sourceCategory !== category) throw new Error(`Item category ${category} does not match source folder ${firstSegment}`);
        }
        sources.push(await sourceMetadata(inputPath, source, claimedSources));
      }


      const definition = CATEGORY_DEFINITIONS.find((entry) => entry.id === category);
      if (!definition) throw new Error(`Unknown item category: ${category}`);
      if (!mixedRoot && category !== rootCategory) throw new Error(`Item category ${category} does not match input folder ${sourceFolder}`);
      items.push({
        id: item.id,
        slug: item.slug,
        name: item.name,
        category,
        metadata: structuredClone(item.metadata ?? {
          images: [{ id: randomUUID(), view: "front", sortOrder: 0, isPrimary: true }],
        }),
        productImages: structuredClone(item.productImages ?? []),
        sources,
        generationAttempts: 0,
        status: "ready",
        acceptedAssets: {},
        attempts: [],
        placement: null,
        review: null,
        quarantine: null,
      });
    }

    const profiles = await loadProfiles();
    const state = {
      version: STATE_VERSION,
      inputMode: mixedRoot ? "mixed" : "category",
      batchSlug,
      inputPath,
      workspacePath,
      createdAt: now,
      updatedAt: now,
      stage: "processing",
      policy: {
        maxGenerationAttempts: 3,
        acceptanceConfidence: 0.9,
        auditRate: 0.1,
        reuseEarlierOutput: false,
      },
      items,
      infrastructureErrors: [],
    };

    for (const item of state.items) {
      const profile = profileForCategory(profiles, item.category);
      item.profile = { category: item.category, relativePath: profile.relativePath, sha256: profile.sha256 };
    }
    await validateBatchState(state, stateFile);
    for (const directory of BATCH_DIRECTORIES) {
      await ensureWorkspaceDirectory(workspacePath, directory);
    }
    await atomicWriteJson(stateFile, state);
    return state;
  });
}

export async function loadBatch(stateFile) {
  let state;
  try {
    state = JSON.parse(await readFile(stateFile, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Malformed batch state JSON at ${stateFile}`, {
        cause: error,
      });
    }
    throw error;
  }
  await validateBatchState(state, stateFile);
  return state;
}

export async function updateItem(stateFile, itemId, mutate) {
  return withStateLock(stateFile, async () => {
    const state = await loadBatch(stateFile);
    const index = state.items.findIndex((item) => item.id === itemId);
    if (index === -1) {
      throw new Error(`Batch item not found: ${itemId}`);
    }
    if (TERMINAL_ITEM_STATUSES.has(state.items[index].status)) {
      throw new Error(
        `Cannot mutate terminal item ${itemId} (${state.items[index].status})`,
      );
    }

    const itemCopy = structuredClone(state.items[index]);
    const mutatedItem = await mutate(itemCopy);
    const nextItem = mutatedItem ?? itemCopy;
    if (!isPlainObject(nextItem)) {
      throw new Error(`Item mutation must return an object: ${itemId}`);
    }
    if (nextItem.id !== itemId) {
      throw new Error(`Item mutation cannot change item id: ${itemId}`);
    }
    if (nextItem.slug !== state.items[index].slug) {
      throw new Error(`Item slug is immutable: ${itemId}`);
    }
    if (!isDeepStrictEqual(nextItem.sources, state.items[index].sources)) {
      throw new Error(`Item source metadata is immutable: ${itemId}`);
    }

    state.items[index] = nextItem;
    state.updatedAt = new Date().toISOString();
    await atomicWriteJson(stateFile, state);
    return state;
  });
}

export async function recordInfrastructureFailure(stateFile, error) {
  return withStateLock(stateFile, async () => {
    const state = await loadBatch(stateFile);
    const failure = {
      at: new Date().toISOString(),
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    };
    if (error instanceof Error && error.stack) {
      failure.stack = error.stack;
    }

    state.infrastructureErrors = [...state.infrastructureErrors, failure];
    state.updatedAt = failure.at;
    await atomicWriteJson(stateFile, state);
    return state;
  });
}
