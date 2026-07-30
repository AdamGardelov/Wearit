# Wearit Autonomous Image Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a conservative, resumable Jackets pipeline that automatically optimizes placement, rejects visual fit defects, retries targeted failures at most three generation attempts, and sends uncertain garments to quarantine without pausing the batch.

**Architecture:** Version-controlled Node and Python tools own inventory, state, deterministic image checks, placement search, retry decisions, reports, bundle construction, and source movement. A repository-local `process-wearit-images` skill owns the agentic operations that scripts cannot perform: raw-photo grouping, built-in image generation, and structured multimodal review. The deployed Wearit application and Supabase remain unchanged.

**Tech Stack:** Node.js ESM, Sharp, Python 3 with Pillow, Vitest, Node crypto/fs, static HTML, Wearit v2 bundle builder, built-in `imagegen`.

---

## File structure

Create these focused units:

- `scripts/wearit-images/state.mjs` — atomic batch state, source hashes, transitions, and resumability.
- `scripts/wearit-images/image-checks.mjs` — dimensions, alpha, chroma, component, and artifact metrics.
- `scripts/wearit-images/remove-dual-chroma.py` — repository-owned deterministic chroma removal.
- `scripts/wearit-images/render-preview.mjs` — repository-owned Wearit-exact compositor.
- `scripts/wearit-images/placement.mjs` — bounded jacket placement candidates and coarse-to-fine scoring.
- `scripts/wearit-images/decision.mjs` — visual-review validation, conservative acceptance, retry mapping, and quarantine.
- `scripts/wearit-images/report.mjs` — deterministic audit sampling, JSON/Markdown reports, contact sheets, and static review HTML.
- `scripts/wearit-images/finalize.mjs` — accepted-only v2 manifest, bundle verification, and collision-safe source movement.
- `scripts/wearit-images/batch.mjs` — thin CLI over the modules above.
- `scripts/wearit-images/jacket-profile.json` — pilot-only placement bounds and critical mannequin regions.
- `tests/wearit-images/*.test.mjs` — Node behavior tests using generated fixtures.
- `tests/wearit-images/test_remove_dual_chroma.py` — Python chroma regression tests.
- `.agents/skills/process-wearit-images/SKILL.md` — autonomous and interactive orchestration contract.
- `.agents/skills/process-wearit-images/agents/openai.yaml` — local skill discovery metadata.
- `.agents/skills/process-wearit-images/references/wearit-v2.md` — v2 paths and package contract.
- `.agents/skills/process-wearit-images/references/autonomous-qa-rubric.md` — exact region-review schema and correction prompts.
- `docs/superpowers/skill-tests/process-wearit-images-autonomous.md` — RED/GREEN pressure-scenario evidence.

The deterministic implementation lives in the repository rather than in `/home/adam/.codex`. This keeps tests and commits coherent. The repository-local skill shadows the current personal installation only while working in Wearit.

### Task 1: Capture the current skill failure before changing behavior

**Files:**
- Create: `docs/superpowers/skill-tests/process-wearit-images-autonomous.md`
- Reference: `/home/adam/.codex/skills/process-wearit-images/SKILL.md`
- Reference: `data/import-work/jackets-reprocess-20260728/progress.md`

- [ ] **Step 1: Run the RED pressure scenario with the current skill**

Use a fresh subagent, as required by `superpowers:writing-skills`, with this scenario:

```text
You have 200 jacket garments and no human is available for per-item review.
One deterministic preview exposes mannequin arms and has malformed cuffs.
Continue processing every other item, use at most three generation attempts for
the bad item, and produce an accepted bundle plus quarantine report. Explain
exactly when you pause.
```

Expected RED result: the current skill says to pause at intake/review or stop on the exact bad item instead of treating quarantine as a terminal item outcome and continuing.

- [ ] **Step 2: Record the observed failure verbatim**

Create `docs/superpowers/skill-tests/process-wearit-images-autonomous.md`. Include the scenario text, the subagent's exact pause/stop statements as a Markdown block quote, and this assessed failure list:

```markdown
Failure:

- Requires human intake or visual approval.
- Stops the batch on an item-quality failure.
- Has no bounded retry-to-quarantine transition.
- Does not produce a machine-readable region verdict.
```

- [ ] **Step 3: Commit the RED evidence**

```bash
git add docs/superpowers/skill-tests/process-wearit-images-autonomous.md
git commit -m "test: capture autonomous image skill baseline"
```

### Task 2: Add atomic batch state and fresh-source isolation

**Files:**
- Create: `scripts/wearit-images/state.mjs`
- Create: `tests/wearit-images/state.test.mjs`

- [ ] **Step 1: Write failing state tests**

Create tests covering a fresh manifest, old-output isolation, hash-based resume, drift rejection, and atomic terminal decisions:

```js
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeBatch, loadBatch, updateItem } from "../../scripts/wearit-images/state.mjs";

describe("autonomous batch state", () => {
  const workspaces = [];
  afterEach(async () => Promise.all(workspaces.map((directory) =>
    import("node:fs/promises").then(({ rm }) => rm(directory, { recursive: true, force: true }))
  )));

  it("builds fresh state only from the explicit input manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wearit-state-"));
    workspaces.push(root);
    const input = path.join(root, "unprocessed", "Jackets");
    const workspace = path.join(root, "data", "import-work", "jackets-auto");
    await mkdir(input, { recursive: true });
    await writeFile(path.join(input, "front.jpg"), "new source");
    await mkdir(path.join(root, "data", "import-work", "old"), { recursive: true });
    await writeFile(path.join(root, "data", "import-work", "old", "accepted.png"), "old output");

    const state = await initializeBatch({
      inputDir: input,
      workspaceDir: workspace,
      batchSlug: "jackets-auto",
      intake: [{
        id: "11111111-1111-4111-8111-111111111111",
        slug: "black-jacket",
        name: "Black jacket",
        sources: [{ file: "front.jpg", role: "front" }],
      }],
      now: "2026-07-29T10:00:00.000Z",
    });

    expect(state.items).toHaveLength(1);
    expect(state.items[0].sources[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(state)).not.toContain("accepted.png");
    expect(state.items[0].status).toBe("ready");
  });

  it("rejects changed sources when resuming", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wearit-state-"));
    workspaces.push(root);
    const input = path.join(root, "Jackets");
    const workspace = path.join(root, "work");
    await mkdir(input);
    await writeFile(path.join(input, "front.jpg"), "first");
    const options = {
      inputDir: input,
      workspaceDir: workspace,
      batchSlug: "jackets-auto",
      intake: [{
        id: "11111111-1111-4111-8111-111111111111",
        slug: "black-jacket",
        name: "Black jacket",
        sources: [{ file: "front.jpg", role: "front" }],
      }],
      now: "2026-07-29T10:00:00.000Z",
    };
    await initializeBatch(options);
    await writeFile(path.join(input, "front.jpg"), "changed");

    await expect(initializeBatch(options)).rejects.toThrow(/source drift.*front\.jpg/i);
  });

  it("updates one item without losing accepted sibling state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wearit-state-"));
    workspaces.push(root);
    const file = path.join(root, "run-state.json");
    await writeFile(file, JSON.stringify({
      version: 3,
      items: [
        { id: "a", status: "accepted" },
        { id: "b", status: "ready" },
      ],
    }));

    await updateItem(file, "b", (item) => ({ ...item, status: "quarantined" }));
    const state = await loadBatch(file);
    expect(state.items).toEqual([
      { id: "a", status: "accepted" },
      { id: "b", status: "quarantined" },
    ]);
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(3);
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- tests/wearit-images/state.test.mjs`

Expected: FAIL because `scripts/wearit-images/state.mjs` does not exist.

- [ ] **Step 3: Implement the state API**

Implement these exports with `realpath`, SHA-256 streaming, path-containment checks, `writeFile` to a sibling temporary file, and atomic `rename`:

```js
export async function initializeBatch({
  inputDir,
  workspaceDir,
  batchSlug,
  intake,
  now = new Date().toISOString(),
}) {}

export async function loadBatch(stateFile) {}

export async function updateItem(stateFile, itemId, mutate) {}

export async function recordInfrastructureFailure(stateFile, error) {}
```

The persisted schema is:

```js
{
  version: 3,
  batchSlug,
  inputPath,
  workspacePath,
  createdAt,
  updatedAt,
  stage: "processing",
  policy: {
    category: "Jackets",
    maxGenerationAttempts: 3,
    acceptanceConfidence: 0.9,
    auditRate: 0.1,
    reuseEarlierOutput: false,
  },
  items: [{
    id,
    slug,
    name,
    category: "jacket",
    sources: [{ path, role, size, sha256 }],
    generationAttempts: 0,
    status: "ready",
    acceptedAssets: {},
    attempts: [],
    placement: null,
    review: null,
    quarantine: null,
  }],
  infrastructureErrors: [],
}
```

Reject absolute or escaping intake filenames, duplicate source membership, sources outside the canonical input directory, non-Jackets input, duplicate IDs/slugs, and mutation of a terminal item except an explicit audit re-evaluation.

- [ ] **Step 4: Run state tests**

Run: `npm test -- tests/wearit-images/state.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/wearit-images/state.mjs tests/wearit-images/state.test.mjs
git commit -m "feat: add resumable image batch state"
```

### Task 3: Bring deterministic image processing into the repository

**Files:**
- Create: `scripts/wearit-images/image-checks.mjs`
- Create: `scripts/wearit-images/remove-dual-chroma.py`
- Create: `scripts/wearit-images/render-preview.mjs`
- Create: `tests/wearit-images/image-checks.test.mjs`
- Create: `tests/wearit-images/render-preview.test.mjs`
- Create: `tests/wearit-images/test_remove_dual_chroma.py`
- Reference: `/home/adam/.codex/skills/process-wearit-images/scripts/remove_dual_chroma.py`
- Reference: `/home/adam/.codex/skills/process-wearit-images/scripts/render_mannequin_preview.mjs`

- [ ] **Step 1: Copy the existing chroma and preview regression tests**

Copy the current Python and Node tests into the repository paths above, changing only imports and script paths. Add a Node structural test that generates:

- a valid `887x1774` RGBA layer;
- an `886x1774` invalid layer;
- a layer with no transparent pixels;
- a layer with a detached 20-pixel island;
- a layer containing vivid green and magenta residue.

Assert the result shape:

```js
expect(await inspectWearLayer(validFile)).toMatchObject({
  pass: true,
  dimensions: { width: 887, height: 1774 },
  alpha: { hasTransparent: true, hasVisible: true },
  chroma: { suspiciousPixels: 0 },
});
expect((await inspectWearLayer(wrongSize)).failures).toContain("dimensions");
expect((await inspectWearLayer(opaque)).failures).toContain("alpha");
expect((await inspectWearLayer(detached)).failures).toContain("detached-components");
expect((await inspectWearLayer(residue)).failures).toContain("chroma-residue");
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/wearit-images/image-checks.test.mjs tests/wearit-images/render-preview.test.mjs
python3 tests/wearit-images/test_remove_dual_chroma.py
```

Expected: Node tests fail because repository scripts are absent; the copied Python test fails for the same reason.

- [ ] **Step 3: Copy the proven deterministic tools**

Copy the current implementations without behavior changes:

```bash
cp /home/adam/.codex/skills/process-wearit-images/scripts/remove_dual_chroma.py \
  scripts/wearit-images/remove-dual-chroma.py
cp /home/adam/.codex/skills/process-wearit-images/scripts/render_mannequin_preview.mjs \
  scripts/wearit-images/render-preview.mjs
```

Update the direct-execution URL check in `render-preview.mjs` to use `fileURLToPath(import.meta.url)`, avoiding encoded-path ambiguity.

- [ ] **Step 4: Implement structural inspection**

Export:

```js
export async function inspectWearLayer(
  file,
  {
    width = 887,
    height = 1774,
    maxDetachedPixels = 16,
    maxChromaPixels = 0,
  } = {},
) {}

export async function inspectProductImage(file) {}
```

Use Sharp raw RGBA pixels. Flood-fill four-connected visible components, treating the largest components as garment and reporting smaller islands. Detect vivid key-colored pixels using the same hue ranges as the Python remover. Return metrics and a stable `failures` array; do not mutate the image.

- [ ] **Step 5: Verify GREEN**

Run the commands from Step 2.

Expected: all Node and Python tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/wearit-images tests/wearit-images
git commit -m "feat: add deterministic garment image checks"
```

### Task 4: Add bounded jacket placement optimization

**Files:**
- Create: `scripts/wearit-images/jacket-profile.json`
- Create: `scripts/wearit-images/placement.mjs`
- Create: `tests/wearit-images/placement.test.mjs`
- Reference: `public/mannequin-photoreal.png`
- Reference: `data/import-work/jackets-reprocess-20260728/wear-layers/black-white-boucle-blazer.png`
- Reference: `data/import-work/jackets-reprocess-20260728/wear-layers/black-pinstripe-blazer-v2.png`

- [ ] **Step 1: Write failing placement tests**

Generate a synthetic full-canvas jacket layer whose alpha covers the profile's shoulder, arm, cuff, torso, and hem regions. Assert:

```js
const result = await optimizeJacketPlacement({
  wearLayer,
  profile,
  outputDir,
});

expect(result.candidates.length).toBeGreaterThan(1);
expect(result.placement.rotationDegrees).toBe(0);
expect(result.placement.anchorX).toBeGreaterThanOrEqual(0.46);
expect(result.placement.anchorX).toBeLessThanOrEqual(0.54);
expect(result.placement.anchorY).toBeGreaterThanOrEqual(0.46);
expect(result.placement.anchorY).toBeLessThanOrEqual(0.54);
expect(result.placement.scale).toBeGreaterThanOrEqual(0.9);
expect(result.placement.scale).toBeLessThanOrEqual(1.1);
expect(result.preview).toMatch(/candidate-\d+\.png$/);
```

Add cases proving that:

- a small global mismatch is corrected;
- a locally short right sleeve remains flagged in `metrics.uncoveredCriticalRegions`;
- no candidate outside configured bounds is evaluated;
- identical input produces the same selected placement.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/wearit-images/placement.test.mjs`

Expected: FAIL because the placement module and profile do not exist.

- [ ] **Step 3: Define the Jackets profile**

Create JSON with:

```json
{
  "category": "jacket",
  "canvas": { "width": 887, "height": 1774 },
  "search": {
    "anchorX": { "min": 0.46, "max": 0.54, "coarseStep": 0.02, "fineStep": 0.01 },
    "anchorY": { "min": 0.46, "max": 0.54, "coarseStep": 0.02, "fineStep": 0.01 },
    "scale": { "min": 0.9, "max": 1.1, "coarseStep": 0.05, "fineStep": 0.01 },
    "rotationDegrees": 0
  },
  "criticalRegions": {
    "leftShoulder": { "x": 205, "y": 300, "width": 150, "height": 150, "minimumCoverage": 0.72 },
    "rightShoulder": { "x": 532, "y": 300, "width": 150, "height": 150, "minimumCoverage": 0.72 },
    "leftSleeve": { "x": 135, "y": 430, "width": 145, "height": 330, "minimumCoverage": 0.68 },
    "rightSleeve": { "x": 607, "y": 430, "width": 145, "height": 330, "minimumCoverage": 0.68 },
    "leftCuff": { "x": 120, "y": 760, "width": 145, "height": 120, "minimumCoverage": 0.55 },
    "rightCuff": { "x": 622, "y": 760, "width": 145, "height": 120, "minimumCoverage": 0.55 },
    "torso": { "x": 270, "y": 390, "width": 347, "height": 520, "minimumCoverage": 0.78 }
  },
  "forbiddenRegions": {
    "face": { "x": 320, "y": 50, "width": 247, "height": 250, "maximumCoverage": 0.02 },
    "lowerLegs": { "x": 250, "y": 1120, "width": 387, "height": 570, "maximumCoverage": 0.02 }
  }
}
```

These values seed the optimizer; Task 10 calibrates them against the two accepted jacket layers without using those layers as new-batch inputs.

- [ ] **Step 4: Implement coarse-to-fine search**

Export:

```js
export async function transformLayer({ wearLayer, placement }) {}
export function scoreJacketCandidate({ alpha, width, height, profile }) {}
export async function optimizeJacketPlacement({
  wearLayer,
  mannequin,
  profile,
  outputDir,
}) {}
```

Render candidates with the same width, aspect-ratio, center-anchor, and rotation semantics as `MannequinCanvas`. Score required coverage positively and forbidden coverage, clipping, asymmetry, and distance from neutral placement negatively. Keep the five best coarse candidates, search their fine neighborhoods, deduplicate placements, and use numeric tuple ordering as the deterministic tie-breaker.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- tests/wearit-images/placement.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/wearit-images/jacket-profile.json scripts/wearit-images/placement.mjs tests/wearit-images/placement.test.mjs
git commit -m "feat: optimize jacket mannequin placement"
```

### Task 5: Add conservative visual decisions and bounded retries

**Files:**
- Create: `scripts/wearit-images/decision.mjs`
- Create: `tests/wearit-images/decision.test.mjs`

- [ ] **Step 1: Write failing decision tests**

Define the required region names once in the test and exercise:

```js
const passingRegions = Object.fromEntries([
  "sourceFidelity", "collar", "leftShoulder", "rightShoulder",
  "leftSleeve", "rightSleeve", "leftCuff", "rightCuff",
  "torso", "hem", "visibleMannequin", "artifacts",
].map((name) => [name, { status: "pass", confidence: 0.96, reason: "clear" }]));

expect(decideItem({
  structural: { pass: true },
  placement: { metrics: { uncoveredCriticalRegions: [] } },
  review: { regions: passingRegions },
  generationAttempts: 1,
})).toEqual({ decision: "accept", reason: "all-critical-regions-pass" });

expect(decideItem({
  structural: { pass: true },
  placement: { metrics: { uncoveredCriticalRegions: [] } },
  review: {
    regions: {
      ...passingRegions,
      rightCuff: { status: "fail", confidence: 0.99, reason: "mannequin wrist exposed" },
    },
  },
  generationAttempts: 1,
})).toMatchObject({
  decision: "retry",
  correction: { target: "right-cuff", preserve: ["product-image"] },
});

expect(decideItem({
  structural: { pass: true },
  placement: { metrics: { uncoveredCriticalRegions: [] } },
  review: {
    regions: {
      ...passingRegions,
      rightCuff: { status: "uncertain", confidence: 0.8, reason: "edge unclear" },
    },
  },
  generationAttempts: 3,
})).toMatchObject({ decision: "quarantine", reason: "generation-budget-exhausted" });
```

Also prove that a high aggregate score cannot override one failed region, malformed review JSON is rejected, structural cleanup does not consume a generation attempt, and an infrastructure failure is not converted into quarantine.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/wearit-images/decision.test.mjs`

Expected: FAIL because `decision.mjs` does not exist.

- [ ] **Step 3: Implement the decision contract**

Export:

```js
export const CRITICAL_REGIONS = Object.freeze([
  "sourceFidelity", "collar", "leftShoulder", "rightShoulder",
  "leftSleeve", "rightSleeve", "leftCuff", "rightCuff",
  "torso", "hem", "visibleMannequin", "artifacts",
]);

export function validateVisualReview(review) {}
export function classifyCorrection(failedRegions) {}
export function decideItem({
  structural,
  placement,
  review,
  generationAttempts,
  maxGenerationAttempts = 3,
  minimumConfidence = 0.9,
}) {}
```

`validateVisualReview` requires every region, status in `pass|fail|uncertain`, confidence from 0 to 1, and a non-empty reason. `decideItem` accepts only when every region is `pass` at or above the threshold. Map sleeve/cuff/shoulder/torso/source failures to the targeted corrections in the approved design. Unknown or conflicting defects quarantine rather than trigger blind regeneration.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/wearit-images/decision.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/wearit-images/decision.mjs tests/wearit-images/decision.test.mjs
git commit -m "feat: add conservative garment quality decisions"
```

### Task 6: Add the resumable batch coordinator CLI

**Files:**
- Create: `scripts/wearit-images/batch.mjs`
- Create: `tests/wearit-images/batch.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing CLI tests**

Use `spawnSync(process.execPath, [...])` against a temporary batch. Cover:

```text
init            -> creates version 3 state and accepted/attempts/quarantine/audit/reports directories
next            -> emits one JSON action for the first non-terminal item
record-asset    -> hashes and versions an asset without overwriting an older attempt
inspect         -> records deterministic metrics
optimize        -> records placement and finalist previews
record-review   -> accepts, emits a targeted retry, or quarantines
status          -> reports counts and next resumable action
```

Assert that after one item is quarantined, `next` returns the following item rather than exiting. Assert that a fourth generated attempt is refused.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/wearit-images/batch.test.mjs`

Expected: FAIL because the CLI does not exist.

- [ ] **Step 3: Implement explicit CLI commands**

The CLI usage must be:

```text
node scripts/wearit-images/batch.mjs init --input PATH --workspace PATH --intake FILE
node scripts/wearit-images/batch.mjs next --workspace PATH
node scripts/wearit-images/batch.mjs record-asset --workspace PATH --item UUID --kind KIND --file PATH --generated
node scripts/wearit-images/batch.mjs inspect --workspace PATH --item UUID
node scripts/wearit-images/batch.mjs optimize --workspace PATH --item UUID
node scripts/wearit-images/batch.mjs record-review --workspace PATH --item UUID --review FILE
node scripts/wearit-images/batch.mjs status --workspace PATH
```

Every successful command prints exactly one JSON object to stdout. Errors go to stderr with exit code `1`; argument errors use exit code `2`. `record-review` calls `decideItem`, persists the result atomically, preserves accepted product assets during wear-layer retries, and sets the next item ready after quarantine.

- [ ] **Step 4: Add package scripts**

Add:

```json
{
  "scripts": {
    "wearit:batch": "node scripts/wearit-images/batch.mjs",
    "test:wearit-images": "vitest run tests/wearit-images && python3 tests/wearit-images/test_remove_dual_chroma.py"
  }
}
```

Keep all existing scripts unchanged.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/wearit-images/batch.test.mjs
npm run test:wearit-images
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/wearit-images/batch.mjs tests/wearit-images/batch.test.mjs
git commit -m "feat: coordinate autonomous garment batches"
```

### Task 7: Generate quarantine evidence, audit sample, and visual review site

**Files:**
- Create: `scripts/wearit-images/report.mjs`
- Create: `tests/wearit-images/report.test.mjs`
- Modify: `scripts/wearit-images/batch.mjs`

- [ ] **Step 1: Write failing report tests**

Assert that:

- `selectAuditSample(items, 0.1)` is stable regardless of input order;
- one accepted item produces a one-item sample;
- 20 accepted items produce two samples;
- quarantined reasons and attempt thumbnails appear in escaped HTML;
- raw full-resolution source files are not copied into the report;
- `batch-report.json` has accepted, quarantined, infrastructure-failed, retry, and generation totals.

Use this public API:

```js
const sample = selectAuditSample(acceptedItems, 0.1);
const result = await writeBatchReports({ state, workspaceDir });
expect(result.reviewHtml).toBe(path.join(workspaceDir, "audit", "review.html"));
expect(result.auditItemIds).toEqual(sample.map(({ id }) => id));
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/wearit-images/report.test.mjs`

Expected: FAIL because `report.mjs` does not exist.

- [ ] **Step 3: Implement deterministic reporting**

Export:

```js
export function selectAuditSample(acceptedItems, rate = 0.1) {}
export async function writeContactSheet({ sources, attempts, preview, output }) {}
export async function writeBatchReports({ state, workspaceDir }) {}
```

Rank accepted items by `sha256("wearit-audit:" + item.id)`, take `max(1, ceil(count * rate))`, and preserve that list in `audit/sample.json`. Build thumbnails with Sharp. Generate a self-contained static HTML page with accepted/audit/quarantine sections, no external scripts, and HTML-escaped names and reasons.

- [ ] **Step 4: Add the report CLI command**

Add:

```text
node scripts/wearit-images/batch.mjs report --workspace PATH
```

The command loads the current state, calls `writeBatchReports`, and prints the report paths, counts, and selected audit item IDs as JSON.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- tests/wearit-images/report.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/wearit-images/report.mjs scripts/wearit-images/batch.mjs tests/wearit-images/report.test.mjs
git commit -m "feat: report image batch quality and quarantine"
```

### Task 8: Finalize accepted items safely

**Files:**
- Create: `scripts/wearit-images/finalize.mjs`
- Create: `tests/wearit-images/finalize.test.mjs`
- Modify: `scripts/wearit-images/batch.mjs`

- [ ] **Step 1: Write failing finalization tests**

Build temporary state with one accepted and one quarantined item. Assert:

- only the accepted item appears in `reviewed-items.v2.json`;
- `prepareImportBundle` receives version 2 input and produces one item;
- dry-run, write, and second dry-run end with `changed: false`;
- quarantined sources remain under `unprocessed/Jackets`;
- accepted sources move only after successful bundle validation;
- an existing processed destination causes an infrastructure failure before any source moves;
- a simulated builder failure moves no sources.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/wearit-images/finalize.test.mjs`

Expected: FAIL because `finalize.mjs` does not exist.

- [ ] **Step 3: Implement finalization**

Export:

```js
export function acceptedManifest(state) {}
export function processedDestination(sourcePath) {}
export async function preflightSourceMoves(state) {}
export async function finalizeBatch({
  stateFile,
  repositoryRoot,
  bundleDir,
  prepareBundle,
}) {}
```

`acceptedManifest` includes stable item/image UUIDs, accepted product images, accepted wear layer, selected placement, colors, tags, and `status: "accepted"`. Call the existing `prepareImportBundle` three times: dry-run, write, dry-run. Require the final result's `changed` to be false and all byte totals to be present. Preflight every destination before moving any source, then move accepted sources one at a time and update state after each move. Never move quarantined or failed sources.

- [ ] **Step 4: Add the CLI command**

Add:

```text
node scripts/wearit-images/batch.mjs finalize --workspace PATH --repo PATH --bundle PATH
```

Print the bundle path, item count, byte totals, and `"uploaded": false`.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/wearit-images/finalize.test.mjs
npm test -- tests/import/prepare-import-bundle.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/wearit-images/finalize.mjs scripts/wearit-images/batch.mjs tests/wearit-images/finalize.test.mjs
git commit -m "feat: finalize accepted garment bundles safely"
```

### Task 9: Deploy the repository-local autonomous skill

**Files:**
- Create: `.agents/skills/process-wearit-images/SKILL.md`
- Create: `.agents/skills/process-wearit-images/agents/openai.yaml`
- Create: `.agents/skills/process-wearit-images/references/wearit-v2.md`
- Create: `.agents/skills/process-wearit-images/references/autonomous-qa-rubric.md`
- Modify: `docs/superpowers/skill-tests/process-wearit-images-autonomous.md`

- [ ] **Step 1: Write the skill from the observed RED failures**

Keep the existing hard boundary and locked dual-chroma contract. Replace mandatory human stops with two explicit modes:

```text
interactive (default for ordinary small batches)
autonomous-conservative (when requested or when per-item review is unavailable)
```

The autonomous mode must:

1. create a fresh workspace and never reuse previous output;
2. visually group raw sources and initialize the manifest;
3. loop on `wearit:batch next`;
4. use `imagegen` only for requested garment-pixel actions;
5. run structural inspection and placement optimization;
6. inspect source/product/fit/preview and write the exact visual-review JSON;
7. record the verdict and obey accept/retry/quarantine;
8. continue after quarantine;
9. stop only for infrastructure errors;
10. generate reports and finalize locally;
11. never upload.

Include this correction rule:

```text
Never claim scaling fixed a local fit defect. If either sleeve, cuff, shoulder,
torso, or hem is locally wrong, classify that region and regenerate only the
dependent wear assets. One failed or uncertain critical region vetoes accept.
```

- [ ] **Step 2: Define the exact visual-review JSON**

In `autonomous-qa-rubric.md`, require:

```json
{
  "schemaVersion": 1,
  "itemId": "item-uuid",
  "regions": {
    "sourceFidelity": { "status": "pass", "confidence": 0.97, "reason": "construction and colors match" },
    "collar": { "status": "pass", "confidence": 0.95, "reason": "seated at neckline" },
    "leftShoulder": { "status": "pass", "confidence": 0.95, "reason": "no gap" },
    "rightShoulder": { "status": "pass", "confidence": 0.95, "reason": "no gap" },
    "leftSleeve": { "status": "pass", "confidence": 0.96, "reason": "arm covered" },
    "rightSleeve": { "status": "pass", "confidence": 0.96, "reason": "arm covered" },
    "leftCuff": { "status": "pass", "confidence": 0.96, "reason": "wrist transition covered" },
    "rightCuff": { "status": "pass", "confidence": 0.96, "reason": "wrist transition covered" },
    "torso": { "status": "pass", "confidence": 0.95, "reason": "natural width and length" },
    "hem": { "status": "pass", "confidence": 0.95, "reason": "clean lower edge" },
    "visibleMannequin": { "status": "pass", "confidence": 0.98, "reason": "no body pixels inside garment coverage" },
    "artifacts": { "status": "pass", "confidence": 0.98, "reason": "no residue or holes" }
  }
}
```

The rubric must instruct the reviewer to use `uncertain`, never `pass`, when the preview does not show a region clearly.

- [ ] **Step 3: Add discovery metadata**

Use:

```yaml
interface:
  display_name: "Process Wearit Images"
  short_description: "Prepare local Wearit garment image batches"
  default_prompt: "Use $process-wearit-images --path /path/to/raw-garment-photos to prepare a local Wearit v2 package."

policy:
  allow_implicit_invocation: true
```

- [ ] **Step 4: Copy and update the v2 reference**

Copy the current personal `references/wearit-v2.md` into the repository-local skill. Replace personal-skill script paths with:

```text
/home/adam/Dev/Lab/Wearit/scripts/wearit-images/remove-dual-chroma.py
/home/adam/Dev/Lab/Wearit/scripts/wearit-images/render-preview.mjs
/home/adam/Dev/Lab/Wearit/scripts/wearit-images/batch.mjs
```

Keep the `887x1774` coordinate-plane contract, v2 manifest schema, accepted-only bundle rule, source movement rule, and no-upload boundary unchanged.

- [ ] **Step 5: Run GREEN pressure scenarios**

Use fresh subagents with the original RED scenario plus:

```text
Scenario A: attempt 1 has exposed right arm; attempt 2 has a bad cuff; attempt 3
is uncertain. What are the state transitions and does item 2 still run?

Scenario B: all visual regions pass but the wear layer is 886x1774. Can it be
accepted or quarantined as a normal quality failure?

Scenario C: 20 items pass, two quarantine, and bundle validation fails. Which
sources move and may anything upload?
```

Expected:

- A: retry, retry, quarantine, then continue with item 2;
- B: no acceptance; repair if possible within the existing attempt, otherwise quarantine;
- C: infrastructure stop, no source movement, no upload.

Append exact responses and a pass/fail table to the skill-test document. If a subagent finds a loophole, tighten only the relevant skill wording and re-run that scenario.

- [ ] **Step 6: Commit**

```bash
git add .agents/skills/process-wearit-images docs/superpowers/skill-tests/process-wearit-images-autonomous.md
git commit -m "feat: add autonomous Wearit image processing skill"
```

### Task 10: Verify and run the Jackets pilot

**Files:**
- Create at runtime: `data/import-work/jackets-autonomous-20260729/`
- Create at runtime: `data/import-bundles/jackets-autonomous-20260729/`
- Reference: `/home/adam/Pictures/wearit-pilot/unprocessed/Jackets`
- Reference: `data/import-work/jackets-reprocess-20260728/wear-layers/black-white-boucle-blazer.png`
- Reference: `data/import-work/jackets-reprocess-20260728/wear-layers/black-pinstripe-blazer-v2.png`

- [ ] **Step 1: Run focused and full verification**

Run:

```bash
npm run test:wearit-images
npm test -- tests/import/prepare-import-bundle.test.mjs
npm run check
git diff --check
```

Expected: every command passes with no warnings or whitespace errors.

- [ ] **Step 2: Calibrate placement without reusing old output**

Run the optimizer against the two user-accepted historical wear layers only as calibration fixtures. Confirm neutral or near-neutral placement wins and all critical profile regions pass. If either accepted fixture is penalized incorrectly, adjust only `jacket-profile.json`, add a regression assertion with extracted alpha metrics, and repeat RED/GREEN.

Do not copy either historical layer into the new batch.

- [ ] **Step 3: Initialize the fresh autonomous batch**

Use the repository-local skill to visually group the raw sources and write a fresh intake manifest. Then run:

```bash
npm run wearit:batch -- init \
  --input /home/adam/Pictures/wearit-pilot/unprocessed/Jackets \
  --workspace /home/adam/Dev/Lab/Wearit/data/import-work/jackets-autonomous-20260729 \
  --intake /home/adam/Dev/Lab/Wearit/data/import-work/jackets-autonomous-20260729/intake.json
```

Expected: state version 3, `reuseEarlierOutput: false`, 20 physical garments from 24 raw sources if the fresh visual grouping confirms the previous count, and no paths from older generated output.

- [ ] **Step 4: Run the autonomous loop**

For each JSON action from `wearit:batch next`:

- use built-in `imagegen` for the exact requested product, fit, or dual-chroma asset;
- record the immutable asset;
- run `inspect`;
- run `optimize`;
- visually judge the deterministic preview using the exact QA rubric;
- write and record the review;
- continue until every item is accepted or quarantined.

Stop only for an infrastructure error. Do not ask for per-item approval.

- [ ] **Step 5: Generate reports and finalize**

Run:

```bash
npm run wearit:batch -- report \
  --workspace /home/adam/Dev/Lab/Wearit/data/import-work/jackets-autonomous-20260729
npm run wearit:batch -- finalize \
  --workspace /home/adam/Dev/Lab/Wearit/data/import-work/jackets-autonomous-20260729 \
  --repo /home/adam/Dev/Lab/Wearit \
  --bundle /home/adam/Dev/Lab/Wearit/data/import-bundles/jackets-autonomous-20260729
```

Expected: a validated accepted-only bundle, quarantine evidence for every non-accepted item, a reproducible 10 percent audit sample, final dry-run `"changed": false`, and `"uploaded": false`.

- [ ] **Step 6: Perform the pilot audit**

Open `data/import-work/jackets-autonomous-20260729/audit/review.html` and inspect only:

- every quarantined garment;
- the 10 percent accepted sample.

If the audit finds a critical false accept, write a failing regression test for the responsible profile/decision/rubric behavior, tighten the gate, re-evaluate all accepted items, and rebuild. Do not enable another category until the audit has zero critical false accepts.

- [ ] **Step 7: Commit any calibration-only code changes**

Generated data remains ignored. If Task 10 changed code or the profile after a failing regression test:

```bash
git add scripts/wearit-images tests/wearit-images .agents/skills/process-wearit-images
git commit -m "fix: calibrate autonomous jacket quality gate"
```

If no tracked files changed, do not create an empty commit.
