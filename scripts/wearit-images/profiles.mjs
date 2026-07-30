import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CATEGORY_DEFINITIONS } from "../../src/domain/slots.js";

const MODULE_PATH = import.meta.url.startsWith("file:")
  ? decodeURIComponent(new URL(import.meta.url).pathname)
  : import.meta.url;
const PROFILE_FILE = path.join(path.dirname(MODULE_PATH), "category-profiles.json");
const PROFILE_PATH = "scripts/wearit-images/category-profiles.json";
const COMMON_REGIONS = new Set(["sourceFidelity", "visibleMannequin", "artifacts"]);
const VALID_CALIBRATION = new Set(["calibrated", "uncalibrated"]);
const PROFILE_REGIONS = { top:["sourceFidelity","neckline","leftShoulder","rightShoulder","leftSleeve","rightSleeve","leftCuff","rightCuff","torso","hem","visibleMannequin","artifacts"], bottom:["sourceFidelity","waist","hips","leftLeg","rightLeg","crotchGap","leftLegHem","rightLegHem","visibleMannequin","artifacts"], dress:["sourceFidelity","neckline","bodice","waist","skirt","hem","leftSleeve","rightSleeve","leftCuff","rightCuff","visibleMannequin","artifacts"], jacket:["sourceFidelity","collar","leftShoulder","rightShoulder","leftSleeve","rightSleeve","leftCuff","rightCuff","torso","hem","visibleMannequin","artifacts"], coat:["sourceFidelity","collar","leftShoulder","rightShoulder","leftSleeve","rightSleeve","leftCuff","rightCuff","torso","lowerBody","hem","visibleMannequin","artifacts"], shoes:["sourceFidelity","leftShoe","rightShoe","openings","soles","pairConsistency","visibleMannequin","artifacts"], hat:["sourceFidelity","crown","brimOrEdge","headOpening","faceObstruction","visibleMannequin","artifacts"], belt:["sourceFidelity","buckle","strap","holesAndDetails","waistAlignment","visibleMannequin","artifacts"], bag:["sourceFidelity","body","handles","straps","openings","carriedSideAlignment","visibleMannequin","artifacts"], scarf:["sourceFidelity","neckArea","loops","ends","internalNegativeSpace","visibleMannequin","artifacts"], accessory:["sourceFidelity","visibleMannequin","artifacts"] };
const OPTIONAL_REGIONS = new Set(["top", "dress", "jacket", "coat"]);
const EXACT_KEYS = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) fail(`${label} has invalid fields`);
};
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fail(message) { throw new Error(`Invalid category profile: ${message}`); }

function validateProfile(profile, definition) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) fail(`${definition.id} must be an object`);
  EXACT_KEYS(profile, ["schemaVersion","category","sourceFolder","slot","layerOrder","reviewRegions","nonApplicableRegions","corrections","placement","evidence","calibration","criticalRegions","forbiddenRegions"], definition.id);
  const required = ["schemaVersion", "category", "sourceFolder", "slot", "layerOrder", "reviewRegions", "nonApplicableRegions", "corrections", "placement", "evidence", "calibration", "criticalRegions", "forbiddenRegions"];
  for (const key of required) if (!(key in profile)) fail(`${definition.id} is missing ${key}`);
  if (profile.schemaVersion !== 1 || profile.category !== definition.id || profile.sourceFolder !== definition.sourceFolder || profile.slot !== definition.slot || profile.layerOrder !== definition.layerOrder) fail(`${definition.id} does not match category registry`);
  if (!Array.isArray(profile.reviewRegions) || profile.reviewRegions.length < 3 || new Set(profile.reviewRegions).size !== profile.reviewRegions.length) fail(`${definition.id} has invalid reviewRegions`);
  if (JSON.stringify(profile.reviewRegions) !== JSON.stringify(PROFILE_REGIONS[definition.id])) fail(`${definition.id} has missing or extra review regions`);
  if (!profile.reviewRegions.includes("sourceFidelity") || !profile.reviewRegions.includes("visibleMannequin") || !profile.reviewRegions.includes("artifacts")) fail(`${definition.id} is missing common review regions`);
  const expectedOptional = OPTIONAL_REGIONS.has(definition.id) ? ["leftSleeve", "rightSleeve", "leftCuff", "rightCuff"] : [];
  if (!Array.isArray(profile.nonApplicableRegions) || JSON.stringify(profile.nonApplicableRegions) !== JSON.stringify(expectedOptional)) fail(`${definition.id} has invalid nonApplicableRegions`);
  const p = profile.placement;
  EXACT_KEYS(p, ["anchorX", "anchorY", "scale", "rotationDegrees"], `${definition.id}.placement`);
  if (p.anchorX !== 0.5 || p.anchorY !== 0.5 || p.scale !== 1 || p.rotationDegrees !== 0) fail(`${definition.id} has invalid neutral placement`);
  const e = profile.evidence;
  EXACT_KEYS(e, ["checkerboards", "topologyCrops", "expectedCoverage"], `${definition.id}.evidence`);
  if (!e || JSON.stringify(e.checkerboards) !== JSON.stringify(["light", "dark"]) || e.topologyCrops !== "item-contract" || !["visual-only", "numeric-and-visual"].includes(e.expectedCoverage)) fail(`${definition.id} has invalid evidence contract`);
  const c = profile.calibration;
  EXACT_KEYS(c, ["status", "method", "evidenceHashes"], `${definition.id}.calibration`);
  if (!Array.isArray(profile.criticalRegions) || !Array.isArray(profile.forbiddenRegions)) fail(`${definition.id} has invalid numeric regions`);
  if (!VALID_CALIBRATION.has(c?.status) || (c.status === "uncalibrated" && (definition.id === "jacket" || c.method !== null || !Array.isArray(c.evidenceHashes) || c.evidenceHashes.length || profile.criticalRegions.length || profile.forbiddenRegions.length))) fail(`${definition.id} has invalid calibration`);
  if (c.status === "calibrated" && (definition.id !== "jacket" || typeof c.method !== "string" || !Array.isArray(c.evidenceHashes) || c.evidenceHashes.length === 0 || c.evidenceHashes.some((h) => !/^[0-9a-f]{64}$/.test(h)))) fail(`${definition.id} has invalid calibrated evidence`);
  if (e.expectedCoverage !== (c.status === "calibrated" ? "numeric-and-visual" : "visual-only")) fail(`${definition.id} has mismatched evidence coverage`);
  const validateNumericRegions = (regions, kind) => {
    if (!Array.isArray(regions)) fail(`${definition.id} has invalid ${kind} regions`);
    for (const region of regions) {
      const coverageKey = kind === "critical" ? "minCoverage" : "maxCoverage";
      EXACT_KEYS(region, ["name", "x", "y", "width", "height", coverageKey, ...(kind === "critical" ? ["seedMinCoverage"] : [])], `${definition.id}.${kind}Region`);
      const coverage = region[kind === "critical" ? "minCoverage" : "maxCoverage"];
      if (typeof region.name !== "string" || !Number.isInteger(region.x) || !Number.isInteger(region.y) || !Number.isInteger(region.width) || !Number.isInteger(region.height) || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || typeof coverage !== "number" || coverage < 0 || coverage > 1 || (kind === "critical" && (typeof region.seedMinCoverage !== "number" || region.seedMinCoverage < 0 || region.seedMinCoverage > 1))) fail(`${definition.id} has invalid ${kind} region values`);
      if (kind === "critical" && !profile.reviewRegions.includes(region.name)) fail(`${definition.id} critical region is not reviewable`);
    }
    if (new Set(regions.map(({ name }) => name)).size !== regions.length) fail(`${definition.id} has duplicate ${kind} regions`);
  };
  validateNumericRegions(profile.criticalRegions, "critical");
  validateNumericRegions(profile.forbiddenRegions, "forbidden");
  for (const region of profile.reviewRegions) {
    if (COMMON_REGIONS.has(region)) continue;
    const correction = profile.corrections?.[region];
    if (COMMON_REGIONS.has(region)) continue;
    EXACT_KEYS(correction, ["target", "preserve", "consumesGenerationAttempt"], `${definition.id}.corrections.${region}`);
    if (!correction || correction.target !== region.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`) || JSON.stringify(correction.preserve) !== JSON.stringify(["product-images"]) || correction.consumesGenerationAttempt !== true) fail(`${definition.id} has invalid correction for ${region}`);
  }
  for (const [name, correction] of Object.entries(profile.corrections ?? {})) if (!profile.reviewRegions.includes(name) || COMMON_REGIONS.has(name) || !correction) fail(`${definition.id} has unexpected correction ${name}`);
  return profile;
}

export async function loadProfiles() {
  const parsed = JSON.parse(await readFile(PROFILE_FILE, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("root must be an object");
  const expected = CATEGORY_DEFINITIONS.map(({ id }) => id);
  if (JSON.stringify(Object.keys(parsed)) !== JSON.stringify(expected)) fail(`keys must be ${expected.join(",")}`);
  const profiles = {};
  for (const definition of CATEGORY_DEFINITIONS) {
    const profile = validateProfile(parsed[definition.id], definition);
    const runtimeFree = { ...profile };
    delete runtimeFree.sha256;
    delete runtimeFree.relativePath;
    profiles[definition.id] = deepFreeze({ ...profile, relativePath: PROFILE_PATH, sha256: createHash("sha256").update(canonicalStringify(runtimeFree), "utf8").digest("hex") });
  }
  return deepFreeze(profiles);
}

export function profileForCategory(profiles, category) {
  const profile = profiles?.[category];
  if (!profile) throw new Error(`Unknown category profile: ${category}`);
  return profile;
}

export { PROFILE_PATH };
