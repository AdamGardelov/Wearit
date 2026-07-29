import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const STATE_VERSION = 3;
const TERMINAL_ITEM_STATUSES = new Set(["accepted", "quarantined"]);
const BATCH_DIRECTORIES = [
  "accepted/product-images",
  "accepted/wear-layers",
  "accepted/mannequin-previews",
  "quarantine",
  "audit/contact-sheets",
  "attempts",
  "reports",
];

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

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
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

async function atomicWriteJson(file, value) {
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

  const sourcePath = await realpath(requestedPath);
  if (!isContained(inputPath, sourcePath)) {
    throw new Error(`Source is outside canonical input directory: ${source.file}`);
  }
  if (claimedSources.has(sourcePath)) {
    throw new Error(`Duplicate source membership: ${source.file}`);
  }

  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile()) {
    throw new Error(`Intake source is not a file: ${source.file}`);
  }

  claimedSources.add(sourcePath);
  return {
    path: sourcePath,
    role: source.role,
    size: sourceStat.size,
    sha256: await sha256(sourcePath),
  };
}

async function validateResumeSources(state) {
  const canonicalInput = await realpath(state.inputPath);

  for (const item of state.items) {
    for (const source of item.sources) {
      const displayName = path.basename(source.path);
      try {
        const canonicalSource = await realpath(source.path);
        if (
          canonicalSource !== source.path
          || !isContained(canonicalInput, canonicalSource)
        ) {
          throw new Error("canonical source path changed");
        }

        const sourceStat = await stat(canonicalSource);
        const digest = await sha256(canonicalSource);
        if (sourceStat.size !== source.size || digest !== source.sha256) {
          throw new Error("source content changed");
        }
      } catch (error) {
        throw new Error(`Source drift detected for ${displayName}`, {
          cause: error,
        });
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
  if (path.basename(inputPath) !== "Jackets") {
    throw new Error(`Only the Jackets input category is supported: ${inputPath}`);
  }

  await mkdir(workspaceDir, { recursive: true });
  const workspacePath = await realpath(workspaceDir);
  const stateFile = path.join(workspacePath, "run-state.json");

  try {
    const existingState = await loadBatch(stateFile);
    if (existingState.inputPath !== inputPath) {
      throw new Error("Existing batch input path does not match requested input");
    }
    if (existingState.workspacePath !== workspacePath) {
      throw new Error("Existing batch workspace path is invalid");
    }
    if (existingState.batchSlug !== batchSlug) {
      throw new Error("Existing batch slug does not match requested batch");
    }
    await validateResumeSources(existingState);
    return existingState;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

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

    const sources = [];
    for (const source of item.sources) {
      sources.push(await sourceMetadata(inputPath, source, claimedSources));
    }

    items.push({
      id: item.id,
      slug: item.slug,
      name: item.name,
      category: "jacket",
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

  for (const directory of BATCH_DIRECTORIES) {
    await ensureWorkspaceDirectory(workspacePath, directory);
  }

  const state = {
    version: STATE_VERSION,
    batchSlug,
    inputPath,
    workspacePath,
    createdAt: now,
    updatedAt: now,
    stage: "processing",
    policy: {
      category: "Jackets",
      maxGenerationAttempts: 3,
      acceptanceConfidence: 0.9,
      auditRate: 0.1,
      reuseEarlierOutput: false,
    },
    items,
    infrastructureErrors: [],
  };

  await atomicWriteJson(stateFile, state);
  return state;
}

export async function loadBatch(stateFile) {
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  if (state?.version !== STATE_VERSION || !Array.isArray(state.items)) {
    throw new Error(`Unsupported or invalid batch state: ${stateFile}`);
  }
  return state;
}

export async function updateItem(stateFile, itemId, mutate) {
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
  if (
    nextItem === null
    || typeof nextItem !== "object"
    || Array.isArray(nextItem)
  ) {
    throw new Error(`Item mutation must return an object: ${itemId}`);
  }
  if (nextItem.id !== itemId) {
    throw new Error(`Item mutation cannot change item id: ${itemId}`);
  }

  state.items[index] = nextItem;
  state.updatedAt = new Date().toISOString();
  await atomicWriteJson(stateFile, state);
  return state;
}

export async function recordInfrastructureFailure(stateFile, error) {
  const state = await loadBatch(stateFile);
  const failure = {
    at: new Date().toISOString(),
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
  if (error instanceof Error && error.stack) {
    failure.stack = error.stack;
  }

  state.infrastructureErrors = [...(state.infrastructureErrors ?? []), failure];
  state.updatedAt = failure.at;
  await atomicWriteJson(stateFile, state);
  return state;
}
