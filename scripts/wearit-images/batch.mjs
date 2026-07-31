import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initializeBatch,
  loadBatch,
  recordInfrastructureFailure,
  updateItem,
} from "./state.mjs";
import { inspectProductImage, inspectWearLayer } from "./image-checks.mjs";
import { evaluatePlacement, optimizeJacketPlacement } from "./placement.mjs";
import { loadProfiles, profileForCategory } from "./profiles.mjs";
import { decideItem, resolveReviewContract } from "./decision.mjs";
import { writeBatchReports } from "./report.mjs";
import { finalizeBatch } from "./finalize.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const DEFAULT_PROFILE = path.join(SCRIPT_DIRECTORY, "jacket-profile.json");
const DEFAULT_MANNEQUIN = path.join(
  REPOSITORY_ROOT,
  "public",
  "mannequin-photoreal.png",
);
const TERMINAL_STATUSES = new Set([
  "accepted",
  "quarantined",
  "failed-infrastructure",
]);
const PRODUCT_KINDS = new Set(["product", "product-image"]);
const PRODUCT_REGENERATION_TARGETS = new Set([
  "source-fidelity",
  "product",
  "product-image",
  "product-regeneration",
]);
const COMMAND_OPTIONS = {
  init: { values: ["input", "workspace", "intake"], flags: [] },
  next: { values: ["workspace"], flags: [] },
  "record-asset": {
    requiredValues: ["workspace", "item", "kind", "file"],
    optionalValues: ["image-id", "view"],
    flags: ["generated"],
  },
  inspect: { values: ["workspace", "item"], flags: [] },
  optimize: { values: ["workspace", "item"], flags: [] },
  "record-review": {
    values: ["workspace", "item", "review"],
    flags: [],
  },
  status: { values: ["workspace"], flags: [] },
  report: { values: ["workspace"], flags: [] },
  finalize: { values: ["workspace", "repo", "bundle"], flags: [] },
};

class UsageError extends Error {}

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  const contract = COMMAND_OPTIONS[command];
  if (!contract) {
    throw new UsageError(`Unknown or missing command: ${command ?? "(none)"}`);
  }
  const values = new Set(contract.values ?? contract.requiredValues);
  const requiredValues = new Set(contract.requiredValues ?? contract.values);
  const optionalValues = new Set(contract.optionalValues ?? []);
  const flags = new Set(contract.flags);
  const options = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--") || token === "--") {
      throw new UsageError(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (Object.hasOwn(options, name)) {
      throw new UsageError(`Duplicate option: --${name}`);
    }
    if (flags.has(name)) {
      options[name] = true;
      continue;
    }
    if (!values.has(name) && !optionalValues.has(name)) {
      throw new UsageError(`Unknown option for ${command}: --${name}`);
    }
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) {
      throw new UsageError(`Option --${name} requires a value`);
    }
    options[name] = value;
    index += 1;
  }
  for (const name of requiredValues) {
    if (!Object.hasOwn(options, name)) {
      throw new UsageError(`Missing required option: --${name}`);
    }
  }
  return { command, options };
}

function batchStateFile(workspace) {
  return path.join(path.resolve(workspace), "run-state.json");
}

function isContained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Malformed ${label} JSON at ${file}`, { cause: error });
    }
    throw error;
  }
}

async function pathExists(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function itemSummary(item) {
  return {
    id: item.id,
    slug: item.slug,
    name: item.name,
    sources: item.sources,
    ...(item.category ? { category: item.category } : {}),
    ...(item.profile ? { profile: item.profile } : {}),
    ...(item.metadata?.images
      ? { productImages: item.productImages?.length ? item.productImages : item.metadata.images }
      : item.productImages ? { productImages: item.productImages } : {}),
  };
}

function acceptedProduct(item) {
  if (item.metadata?.images) return Object.values(item.acceptedAssets).find((asset) => asset?.kind?.startsWith("product-image:"));
  return item.acceptedAssets["product-image"] ?? item.acceptedAssets.product;
}

function permitsProductRegeneration(item) {
  return PRODUCT_REGENERATION_TARGETS.has(item.requestedCorrection?.target);
}

function latestAssets(item) {
  if (item.metadata?.images) {
    const selected = { ...item.acceptedAssets };
    for (const asset of item.attempts) {
      if (asset?.kind === "wear-layer" && asset.path) selected["wear-layer"] = asset;
      if (asset?.kind?.startsWith("product-image:") && asset.path) selected[asset.kind] = asset;
    }
    const productImages = item.metadata.images
      .slice().sort((a, b) => a.sortOrder - b.sortOrder)
      .map((image) => selected[`product-image:${image.id}`] ?? selected[image.id])
      .filter(Boolean);
    return { ...selected, productImages };
  }
  const selected = { ...item.acceptedAssets };
  const preservedProduct = permitsProductRegeneration(item)
    ? undefined
    : acceptedProduct(item);
  for (const asset of item.attempts) {
    if (PRODUCT_KINDS.has(asset?.kind) && preservedProduct) continue;
    if (asset?.kind && asset?.path) selected[asset.kind] = asset;
  }
  if (preservedProduct) selected["product-image"] = preservedProduct;
  return selected;
}

async function profileForItem(state, item) {
  if (state.version === 3) {
    // v3 predates per-category coverage and only ever carries jackets, so it
    // borrows the jacket floors rather than falling back to inspectWearLayer's
    // built-in defaults. Keeps one source of truth for the numbers.
    const [runtime, categoryProfiles] = await Promise.all([loadProfile(), loadProfiles()]);
    return { ...runtime, coverage: profileForCategory(categoryProfiles, "jacket").coverage };
  }
  const profiles = await loadProfiles();
  const profile = profileForCategory(profiles, item.category);
  if (profile.sha256 !== item.profile?.sha256) {
    throw new Error(`Profile drift for ${item.slug}: expected ${item.profile?.sha256}, got ${profile.sha256}`);
  }
  // Category profiles own review/correction and numeric placement regions;
  // the shared neutral search/canvas runtime contract remains in the legacy
  // profile until each category receives calibrated geometry.
  const runtime = await loadProfile();
  return {
    ...runtime,
    ...profile,
    canvas: runtime.canvas,
    search: runtime.search,
    scoring: runtime.scoring,
  };
}

function statusCounts(state) {
  const counts = {
    total: state.items.length,
    ready: 0,
    generating: 0,
    processing: 0,
    placing: 0,
    reviewing: 0,
    accepted: 0,
    quarantined: 0,
    "failed-infrastructure": 0,
    terminal: 0,
  };
  for (const item of state.items) {
    counts[item.status] += 1;
    if (TERMINAL_STATUSES.has(item.status)) counts.terminal += 1;
  }
  return counts;
}

function completionAction(state) {
  const counts = statusCounts(state);
  return {
    action: "complete",
    counts: {
      total: counts.total,
      accepted: counts.accepted,
      quarantined: counts.quarantined,
      "failed-infrastructure": counts["failed-infrastructure"],
      terminal: counts.terminal,
    },
  };
}

function nextAction(state) {
  const infrastructureItem = state.items.find(
    ({ status }) => status === "failed-infrastructure",
  );
  if (infrastructureItem || state.infrastructureErrors.length > 0) {
    return {
      action: "infrastructure-stop",
      item: infrastructureItem ? itemSummary(infrastructureItem) : null,
      infrastructureErrors: state.infrastructureErrors,
    };
  }
  const item = state.items.find(
    ({ status }) => !TERMINAL_STATUSES.has(status),
  );
  if (!item) return completionAction(state);
  const base = { item: itemSummary(item) };

  if (item.status === "ready" || item.status === "generating") {
    return {
      action: "generate",
      ...base,
      generationAttempt: item.generationAttempts + 1,
      correction: item.requestedCorrection ?? null,
      preserve: item.requestedCorrection?.preserve ?? [],
      acceptedAssets: item.acceptedAssets,
    };
  }
  if (item.status === "processing") {
    return { action: "inspect", ...base, assets: latestAssets(item) };
  }
  if (item.status === "placing") {
    return {
      action: "optimize",
      ...base,
      wearLayer: latestAssets(item)["wear-layer"] ?? null,
    };
  }
  if (item.status === "reviewing") {
    return {
      action: "review",
      ...base,
      structural: item.structural ?? null,
      placement: item.placement ?? null,
    };
  }
  throw new Error(`Unsupported resumable item status: ${item.status}`);
}

async function loadProfile() {
  return readJson(
    process.env.WEARIT_BATCH_PROFILE || DEFAULT_PROFILE,
    "jacket profile",
  );
}

async function commandInit(options) {
  const resumed = await pathExists(batchStateFile(options.workspace));
  const state = await initializeBatch({
    inputDir: options.input,
    workspaceDir: options.workspace,
    batchSlug: path.basename(path.resolve(options.workspace)),
    intake: await readJson(path.resolve(options.intake), "intake"),
  });
  return {
    command: "init",
    version: state.version,
    batchSlug: state.batchSlug,
    workspace: state.workspacePath,
    total: state.items.length,
    resumed,
  };
}

async function commandNext(options) {
  const state = await loadBatch(batchStateFile(options.workspace));
  const item = state.items.find(({ status }) => !TERMINAL_STATUSES.has(status));
  if (item) await profileForItem(state, item);
  return nextAction(state);
}

async function canonicalWorkspaceFile(workspace, requestedFile) {
  const workspacePath = await realpath(workspace);
  const file = await realpath(requestedFile);
  if (!isContained(workspacePath, file)) {
    throw new Error(`Asset file must be inside the batch workspace: ${file}`);
  }
  const fileStat = await lstat(file);
  if (!fileStat.isFile()) throw new Error(`Asset is not a regular file: ${file}`);
  return { workspacePath, file };
}

async function validateManagedDirectory(workspacePath, directory) {
  const workspaceCanonical = await realpath(workspacePath);
  if (workspaceCanonical !== workspacePath) {
    throw new Error(`Workspace path is no longer canonical: ${workspacePath}`);
  }
  const directoryStat = await lstat(directory);
  if (directoryStat.isSymbolicLink()) {
    throw new Error(`Managed workspace directory is a symlink: ${directory}`);
  }
  if (!directoryStat.isDirectory()) {
    throw new Error(`Managed workspace path is not a directory: ${directory}`);
  }
  const canonical = await realpath(directory);
  if (!isContained(workspaceCanonical, canonical)) {
    throw new Error(`Managed directory escapes workspace: ${directory}`);
  }
  return canonical;
}

async function ensureManagedDirectory(workspacePath, segments) {
  let current = workspacePath;
  await validateManagedDirectory(workspacePath, current);
  for (const segment of segments) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segment)) {
      throw new Error(`Invalid managed directory segment: ${segment}`);
    }
    const candidate = path.join(current, segment);
    try {
      await validateManagedDirectory(workspacePath, candidate);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await validateManagedDirectory(workspacePath, current);
      await mkdir(candidate);
      await validateManagedDirectory(workspacePath, candidate);
    }
    current = candidate;
  }
  return current;
}

async function failInfrastructure(statePath, item, command, cause) {
  const error = new Error(
    `${command} infrastructure failure for ${item.slug} (${item.id}):`
      + ` ${cause.message}`,
    { cause },
  );
  error.name = cause.name || "InfrastructureError";
  await updateItem(statePath, item.id, (current) => ({
    ...current,
    status: "failed-infrastructure",
  }));
  await recordInfrastructureFailure(statePath, error);
  return error;
}

function validateKind(kind) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(kind)) {
    throw new UsageError(`Invalid asset kind: ${kind}`);
  }
}

async function commandRecordAsset(options) {
  validateKind(options.kind);
  const statePath = batchStateFile(options.workspace);
  const state = await loadBatch(statePath);
  const item = state.items.find(({ id }) => id === options.item);
  if (!item) throw new Error(`Batch item not found: ${options.item}`);
  const isProduct = PRODUCT_KINDS.has(options.kind);
  if (state.version === 4 && isProduct) {
    if (!options["image-id"] || !options.view) {
      throw new UsageError("Product assets require --image-id and --view");
    }
    if (!["front", "back", "detail"].includes(options.view)) {
      throw new UsageError(`Invalid product image view: ${options.view}`);
    }
    const image = item.metadata.images.find(({ id }) => id === options["image-id"]);
    if (!image) throw new Error(`Product image id is not approved for ${item.id}: ${options["image-id"]}`);
    if (image.view !== options.view) throw new Error(`Product image view does not match approved metadata for ${item.id}`);
  } else if (!isProduct && (options["image-id"] || options.view)) {
    throw new UsageError("--image-id and --view are only valid for product assets");
  }
  if (
    PRODUCT_KINDS.has(options.kind)
    && acceptedProduct(item)
    && !permitsProductRegeneration(item)
  ) {
    throw new Error(`Accepted product asset is preserved for ${item.id}`);
  }
  if (
    options.generated
    && item.generationAttempts >= state.policy.maxGenerationAttempts
  ) {
    throw new Error(
      `Generation attempt limit reached for ${item.id}`
      + ` (${state.policy.maxGenerationAttempts})`,
    );
  }

  const { workspacePath, file } = await canonicalWorkspaceFile(
    state.workspacePath,
    options.file,
  );
  const assetKind = state.version === 4 && isProduct
    ? `product-image:${options["image-id"]}`
    : options.kind;
  const version = item.attempts.filter(({ kind }) => kind === assetKind).length + 1;
  const extension = path.extname(file).toLowerCase() || ".bin";
  const attemptDirectory = await ensureManagedDirectory(
    workspacePath, ["attempts", item.slug],
  );
  const immutablePath = path.join(
    attemptDirectory,
    `${options.kind}-v${String(version).padStart(3, "0")}${extension}`,
  );
  await copyFile(file, immutablePath, constants.COPYFILE_EXCL);
  await ensureManagedDirectory(workspacePath, ["attempts", item.slug]);
  const content = await readFile(immutablePath);
  const asset = {
    kind: assetKind,
    ...(isProduct && state.version === 4 ? { imageId: options["image-id"], view: options.view } : {}),
    version,
    path: await realpath(immutablePath),
    size: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
    generated: options.generated === true,
    recordedAt: new Date().toISOString(),
  };

  try {
    const updated = await updateItem(statePath, item.id, (current) => ({
      ...current,
      generationAttempts: current.generationAttempts
        + (options.generated ? 1 : 0),
      status: "processing",
      attempts: [...current.attempts, asset],
      structural: null,
      placement: null,
      review: null,
    }));
    const updatedItem = updated.items.find(({ id }) => id === item.id);
    return {
      command: "record-asset",
      item: itemSummary(updatedItem),
      asset,
      generationAttempts: updatedItem.generationAttempts,
    };
  } catch (error) {
    await unlink(immutablePath).catch(() => {});
    throw error;
  }
}

function requireSelectedAssets(item) {
  const assets = latestAssets(item);
  if (!assets["wear-layer"]) throw new Error(`Item ${item.id} has no recorded wear-layer`);
  if (item.metadata?.images) {
    for (const image of item.metadata.images.filter((entry) => entry.view === "front" || entry.view === "back")) {
      if (!assets.productImages?.some((asset) => asset.imageId === image.id)) throw new Error(`Item ${item.id} has no recorded product image ${image.id}`);
    }
  } else if (!assets["product-image"]) throw new Error(`Item ${item.id} has no recorded product-image`);
  return assets;
}

async function commandInspect(options) {
  const statePath = batchStateFile(options.workspace);
  const state = await loadBatch(statePath);
  const item = state.items.find(({ id }) => id === options.item);
  if (!item) throw new Error(`Batch item not found: ${options.item}`);
  const assets = requireSelectedAssets(item);
  const productAssets = assets.productImages ?? [assets["product-image"]];
  let product;
  let wear;
  try {
    const profile = await profileForItem(state, item);
    const primaryProduct = productAssets.find((asset) => asset?.view === "front") ?? productAssets[0];
    [product, wear] = await Promise.all([
      inspectProductImage(primaryProduct.path),
      inspectWearLayer(assets["wear-layer"].path, {
        width: profile.canvas.width,
        height: profile.canvas.height,
        minVisibleFraction: profile.coverage.minVisibleFraction,
        minLargestComponentFraction: profile.coverage.minLargestComponentFraction,
      }),
    ]);
  } catch (error) {
    throw await failInfrastructure(statePath, item, "inspect", error);
  }
  const structural = {
    itemId: item.id,
    pass: product.pass && wear.pass,
    failures: [...new Set([...product.failures, ...wear.failures])],
    product,
    wear,
    assets: {
      "product-image": assets["product-image"],
      productImages: productAssets,
      "wear-layer": assets["wear-layer"],
    },
  };
  await updateItem(statePath, item.id, (current) => ({
    ...current,
    status: structural.pass ? "placing" : "reviewing",
    structural,
    placement: structural.pass ? current.placement : null,
  }));
  return { command: "inspect", item: itemSummary(item), structural };
}

async function commandOptimize(options) {
  const statePath = batchStateFile(options.workspace);
  const state = await loadBatch(statePath);
  const item = state.items.find(({ id }) => id === options.item);
  if (!item) throw new Error(`Batch item not found: ${options.item}`);
  if (!item.structural?.pass) {
    throw new Error(`Item ${item.id} must pass inspection before optimization`);
  }
  const assets = requireSelectedAssets(item);
  const version = (item.placements?.length ?? 0) + 1;
  const placementDirectory = `placement-v${String(version).padStart(3, "0")}`;
  let result;
  try {
    const profile = await profileForItem(state, item);
    const outputDir = await ensureManagedDirectory(
      state.workspacePath, ["attempts", item.slug, placementDirectory],
    );
    await ensureManagedDirectory(
      state.workspacePath, ["attempts", item.slug, placementDirectory],
    );
    result = state.version === 4
      ? await evaluatePlacement({
        wearLayer: assets["wear-layer"].path,
        mannequin: process.env.WEARIT_BATCH_MANNEQUIN || DEFAULT_MANNEQUIN,
        profile,
        outputDirectory: outputDir,
      })
      : await optimizeJacketPlacement({
      wearLayer: assets["wear-layer"].path,
      mannequin: process.env.WEARIT_BATCH_MANNEQUIN || DEFAULT_MANNEQUIN,
      profile,
      outputDir,
      });
  } catch (error) {
    throw await failInfrastructure(statePath, item, "optimize", error);
  }
  const placement = { itemId: item.id, version, ...result };
  await updateItem(statePath, item.id, (current) => ({
    ...current,
    status: "reviewing",
    placement,
    placements: [...(current.placements ?? []), placement],
  }));
  return { command: "optimize", item: itemSummary(item), placement };
}

function deterministicAttempts(item) {
  return item.deterministicAttempts ?? { cleanup: 0, placement: 0 };
}

function assetsForKinds(item, kinds) {
  const assets = latestAssets(item);
  if (item.metadata?.images && (kinds.includes("product-image") || kinds.includes("product-images"))) {
    const selected = Object.fromEntries((assets.productImages ?? []).map((asset) => [asset.kind, asset]));
    if (kinds.includes("wear-layer") && assets["wear-layer"]) selected["wear-layer"] = assets["wear-layer"];
    return selected;
  }
  return Object.fromEntries(
    kinds.filter((kind) => assets[kind]).map((kind) => [kind, assets[kind]]),
  );
}

async function commandRecordReview(options) {
  const statePath = batchStateFile(options.workspace);
  const state = await loadBatch(statePath);
  const item = state.items.find(({ id }) => id === options.item);
  if (!item) throw new Error(`Batch item not found: ${options.item}`);
  if (!item.structural) {
    throw new Error(`Item ${item.id} must be inspected before review`);
  }
  const review = await readJson(path.resolve(options.review), "review");
  const profile = await profileForItem(state, item);
  const reviewContract = state.version === 4 ? resolveReviewContract(profile, item.contract) : undefined;
  const attempts = deterministicAttempts(item);
  const decision = decideItem({
    structural: item.structural,
    placement: item.placement,
    review,
    deterministicAttempts: attempts,
    generationAttempts: item.generationAttempts,
    maxGenerationAttempts: state.policy.maxGenerationAttempts,
    minimumConfidence: state.policy.acceptanceConfidence,
  }, reviewContract);

  const updated = await updateItem(statePath, item.id, (current) => {
    const next = {
      ...current,
      review,
      decision,
      deterministicAttempts: { ...attempts },
    };
    if (decision.decision === "accept") {
      next.status = "accepted";
      next.acceptedAssets = {
        ...current.acceptedAssets,
        ...assetsForKinds(current, ["product-image", "wear-layer"]),
      };
      next.requestedCorrection = null;
    } else if (decision.decision === "retry") {
      next.status = decision.correction.target === "placement"
        ? "placing"
        : decision.correction.target === "deterministic-cleanup"
          ? "processing"
          : "ready";
      next.acceptedAssets = {
        ...current.acceptedAssets,
        ...assetsForKinds(current, decision.correction.preserve),
      };
      next.requestedCorrection = decision.correction;
      if (decision.correction.target === "deterministic-cleanup") {
        next.deterministicAttempts.cleanup += 1;
      }
      if (decision.correction.target === "placement") {
        next.deterministicAttempts.placement += 1;
      }
    } else if (decision.decision === "quarantine") {
      next.status = "quarantined";
      next.quarantine = { at: new Date().toISOString(), ...decision };
      next.requestedCorrection = null;
    } else {
      next.status = "failed-infrastructure";
      next.requestedCorrection = null;
    }
    return next;
  });
  let finalState = updated;
  if (decision.decision === "stop") {
    const cause = new Error(decision.error.message);
    cause.name = decision.error.name;
    const error = new Error(
      `record-review infrastructure failure for ${item.slug} (${item.id}):`
        + ` ${cause.message}`,
      { cause },
    );
    error.name = cause.name;
    await recordInfrastructureFailure(statePath, error);
    finalState = await loadBatch(statePath);
  }
  const updatedItem = finalState.items.find(({ id }) => id === item.id);
  return {
    command: "record-review",
    item: itemSummary(updatedItem),
    status: updatedItem.status,
    decision,
    deterministicAttempts: updatedItem.deterministicAttempts,
    acceptedAssets: updatedItem.acceptedAssets,
    next: nextAction(finalState),
  };
}

async function commandStatus(options) {
  const state = await loadBatch(batchStateFile(options.workspace));
  return {
    command: "status",
    version: state.version,
    batchSlug: state.batchSlug,
    counts: statusCounts(state),
    next: nextAction(state),
  };
}
async function commandReport(options) {
  const state = await loadBatch(batchStateFile(options.workspace));
  const report = await writeBatchReports({
    state,
    workspaceDir: state.workspacePath,
  });
  return { command: "report", ...report };
}

async function commandFinalize(options) {
  const result = await finalizeBatch({
    stateFile: batchStateFile(options.workspace),
    repositoryRoot: options.repo,
    bundleDir: options.bundle,
  });
  return {
    command: "finalize",
    bundle: result.outputDir,
    accepted: result.accepted,
    bytes: result.bytes,
    uploaded: false,
  };
}


const COMMANDS = {
  init: commandInit,
  next: commandNext,
  "record-asset": commandRecordAsset,
  inspect: commandInspect,
  optimize: commandOptimize,
  "record-review": commandRecordReview,
  status: commandStatus,
  report: commandReport,
  finalize: commandFinalize,
};

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  return COMMANDS[command](options);
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.stdout.write(`${JSON.stringify(await main())}\n`);
  } catch (error) {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
