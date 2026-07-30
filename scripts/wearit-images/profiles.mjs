import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CATEGORY_DEFINITIONS } from "../../src/domain/slots.js";

const PROFILE_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), "category-profiles.json");
const PROFILE_PATH = "scripts/wearit-images/category-profiles.json";
const COMMON_REGIONS = new Set(["sourceFidelity", "visibleMannequin", "artifacts"]);
const VALID_CALIBRATION = new Set(["calibrated", "uncalibrated"]);
const PROFILE_REGIONS = { top:["sourceFidelity","neckline","leftShoulder","rightShoulder","leftSleeve","rightSleeve","leftCuff","rightCuff","torso","hem","visibleMannequin","artifacts"], bottom:["sourceFidelity","waist","hips","leftLeg","rightLeg","crotchGap","leftLegHem","rightLegHem","visibleMannequin","artifacts"], dress:["sourceFidelity","neckline","bodice","waist","skirt","hem","leftSleeve","rightSleeve","leftCuff","rightCuff","visibleMannequin","artifacts"], jacket:["sourceFidelity","collar","leftShoulder","rightShoulder","leftSleeve","rightSleeve","leftCuff","rightCuff","torso","hem","visibleMannequin","artifacts"], coat:["sourceFidelity","collar","leftShoulder","rightShoulder","leftSleeve","rightSleeve","leftCuff","rightCuff","torso","lowerBody","hem","visibleMannequin","artifacts"], shoes:["sourceFidelity","leftShoe","rightShoe","openings","soles","pairConsistency","visibleMannequin","artifacts"], hat:["sourceFidelity","crown","brimOrEdge","headOpening","faceObstruction","visibleMannequin","artifacts"], belt:["sourceFidelity","buckle","strap","holesAndDetails","waistAlignment","visibleMannequin","artifacts"], bag:["sourceFidelity","body","handles","straps","openings","carriedSideAlignment","visibleMannequin","artifacts"], scarf:["sourceFidelity","neckArea","loops","ends","internalNegativeSpace","visibleMannequin","artifacts"], accessory:["sourceFidelity","visibleMannequin","artifacts"] };

export function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fail(message) { throw new Error(`Invalid category profile: ${message}`); }

function validateProfile(profile, definition) {
  if (!profile || typeof profile !== "object") fail(` must be an object`);
  const allowed = new Set(["schemaVersion","category","sourceFolder","slot","layerOrder","reviewRegions","nonApplicableRegions","corrections","placement","evidence","calibration","criticalRegions","forbiddenRegions","relativePath","sha256"]);
  if (Object.keys(profile).some((key) => !allowed.has(key))) fail(` has unknown fields`);
  const required = ["schemaVersion", "category", "sourceFolder", "slot", "layerOrder", "reviewRegions", "nonApplicableRegions", "corrections", "placement", "evidence", "calibration", "criticalRegions", "forbiddenRegions"];
  for (const key of required) if (!(key in profile)) fail(`${definition.id} is missing ${key}`);
  if (profile.schemaVersion !== 1 || profile.category !== definition.id || profile.sourceFolder !== definition.sourceFolder || profile.slot !== definition.slot || profile.layerOrder !== definition.layerOrder) fail(`${definition.id} does not match category registry`);
  if (!Array.isArray(profile.reviewRegions) || profile.reviewRegions.length < 3 || new Set(profile.reviewRegions).size !== profile.reviewRegions.length) fail(`${definition.id} has invalid reviewRegions`);
  if (JSON.stringify(profile.reviewRegions) !== JSON.stringify(PROFILE_REGIONS[definition.id])) fail(` has missing or extra review regions`);
  if (!profile.reviewRegions.includes("sourceFidelity") || !profile.reviewRegions.includes("visibleMannequin") || !profile.reviewRegions.includes("artifacts")) fail(`${definition.id} is missing common review regions`);
  if (!Array.isArray(profile.nonApplicableRegions) || profile.nonApplicableRegions.some((r) => !profile.reviewRegions.includes(r))) fail(`${definition.id} has invalid nonApplicableRegions`);
  const p = profile.placement;
  if (!p || p.anchorX !== 0.5 || p.anchorY !== 0.5 || p.scale !== 1 || p.rotationDegrees !== 0) fail(`${definition.id} has invalid neutral placement`);
  const e = profile.evidence;
  if (!e || JSON.stringify(e.checkerboards) !== JSON.stringify(["light", "dark"]) || e.topologyCrops !== "item-contract" || !["visual-only", "numeric-and-visual"].includes(e.expectedCoverage)) fail(`${definition.id} has invalid evidence contract`);
  const c = profile.calibration;
  if (!c || !VALID_CALIBRATION.has(c.status) || (c.status === "uncalibrated" && (c.method !== null || !Array.isArray(c.evidenceHashes) || c.evidenceHashes.length || profile.criticalRegions.length || profile.forbiddenRegions.length))) fail(`${definition.id} has invalid calibration`);
  if (c.status === "calibrated" && (typeof c.method !== "string" || !Array.isArray(c.evidenceHashes) || c.evidenceHashes.some((h) => !/^[0-9a-f]{64}$/.test(h)))) fail(`${definition.id} has invalid calibrated evidence`);
  if (e.expectedCoverage !== (c.status === "calibrated" ? "numeric-and-visual" : "visual-only")) fail(`${definition.id} has mismatched evidence coverage`);
  if (!Array.isArray(profile.criticalRegions) || !Array.isArray(profile.forbiddenRegions)) fail(`${definition.id} has invalid numeric regions`);
  for (const region of profile.reviewRegions) {
    if (COMMON_REGIONS.has(region)) continue;
    const correction = profile.corrections?.[region];
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
    profiles[definition.id] = Object.freeze({ ...profile, relativePath: PROFILE_PATH, sha256: createHash("sha256").update(canonicalStringify(runtimeFree), "utf8").digest("hex") });
  }
  return Object.freeze(profiles);
}

export function profileForCategory(profiles, category) {
  const profile = profiles?.[category];
  if (!profile) throw new Error(`Unknown category profile: ${category}`);
  return profile;
}

export { PROFILE_PATH };
