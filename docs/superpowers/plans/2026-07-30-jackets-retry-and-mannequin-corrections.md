# Jackets Retry and Mannequin Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a fresh terminal batch for the eight remaining jacket photos, corrected mannequin-only assets for three accepted jackets, and a local before/after review page.

**Architecture:** Run the six quarantined garments through a new autonomous state-machine workspace sourced only from `unprocessed/Jackets`. Run the three accepted corrections in a separate workspace, copy their existing product images byte-for-byte, regenerate only fit/wear assets, and finalize independent bundles so the earlier package remains immutable.

**Tech Stack:** Wearit image batch CLI, built-in image generation, Python chroma removal, Sharp-based structural inspection and placement optimization, static HTML.

---

## File structure

- Create: `data/import-work/jackets-retry-20260730/intake.json` — exact grouping for the eight unprocessed images.
- Create: `data/import-work/jackets-retry-20260730/run-state.json` and generated subdirectories — fresh six-item state and evidence.
- Create: `data/import-input/jackets-wear-corrections-20260730/Jackets/` — isolated copies of the three processed source photos.
- Create: `data/import-work/jackets-wear-corrections-20260730/intake.json` — stable IDs and source mapping for corrections.
- Create: `data/import-work/jackets-wear-corrections-20260730/run-state.json` and generated subdirectories — three-item correction state and evidence.
- Create: `data/import-work/jackets-wear-corrections-20260730/audit/comparison.html` — previous/new and alpha-background comparisons.
- Create: `data/import-bundles/jackets-retry-20260730/` — accepted retry assets and v2 manifest.
- Create: `data/import-bundles/jackets-wear-corrections-20260730/` — three replacement records and v2 manifest.
- Preserve: `data/import-bundles/jackets-autonomous-20260729/` — previous finalized package.

### Task 1: Freeze and verify retry intake

- [ ] **Step 1: Verify the canonical directory contains exactly the expected eight files**

Run:

```bash
find /home/adam/Pictures/wearit-pilot/unprocessed/Jackets -maxdepth 1 -type f -printf '%f\n' | sort
```

Expected:

```text
IMG_9751.jpg
IMG_9754.jpg
IMG_9833.jpg
IMG_9837.jpg
IMG_9838.jpg
IMG_9839.jpg
IMG_9840.jpg
IMG_9841.jpg
```

- [ ] **Step 2: Create the retry intake**

Create `data/import-work/jackets-retry-20260730/intake.json` with:

```json
[
  {"id":"e5a718bf-92c5-4ba7-b856-9f7be4285110","slug":"white-sleeveless-double-breasted-blazer","name":"White sleeveless double-breasted blazer","sources":[{"file":"IMG_9751.jpg","role":"front"}]},
  {"id":"7b68396e-c3f6-4475-8973-b6f416062a70","slug":"dark-plum-double-breasted-blazer","name":"Dark plum double-breasted blazer","sources":[{"file":"IMG_9754.jpg","role":"front"}]},
  {"id":"d2d518b8-4ee8-4013-b56b-d5d9a2882771","slug":"washed-black-denim-jacket","name":"Washed black denim jacket","sources":[{"file":"IMG_9833.jpg","role":"front"}]},
  {"id":"21d7ee01-60cc-443a-a7a7-d6ba485f0de7","slug":"blue-patchwork-denim-jacket","name":"Blue patchwork denim jacket","sources":[{"file":"IMG_9838.jpg","role":"front"},{"file":"IMG_9839.jpg","role":"back"},{"file":"IMG_9837.jpg","role":"supporting"}]},
  {"id":"e261c834-e3d0-4d01-be70-7618077d09f2","slug":"indigo-utility-denim-jacket","name":"Indigo utility denim jacket","sources":[{"file":"IMG_9840.jpg","role":"front"}]},
  {"id":"ada462f7-d4c4-40a8-93cc-406d37ff5f9a","slug":"black-faux-leather-biker-jacket","name":"Black faux-leather biker jacket","sources":[{"file":"IMG_9841.jpg","role":"front"}]}
]
```

- [ ] **Step 3: Initialize and verify fresh state**

Run:

```bash
node scripts/wearit-images/batch.mjs init \
  --input /home/adam/Pictures/wearit-pilot/unprocessed/Jackets \
  --workspace data/import-work/jackets-retry-20260730 \
  --intake data/import-work/jackets-retry-20260730/intake.json
node scripts/wearit-images/batch.mjs status \
  --workspace data/import-work/jackets-retry-20260730
```

Expected: `total: 6`, `ready: 6`, `terminal: 0`, and `resumed: false`.

### Task 2: Process all six retry garments autonomously

- [ ] **Step 1: Follow `next` for each non-terminal item**

Run:

```bash
node scripts/wearit-images/batch.mjs next \
  --workspace data/import-work/jackets-retry-20260730
```

For `action: generate`, create a source-faithful product image and mannequin fit using the listed source images. Treat sleeveless garments as intentionally having no sleeves or cuffs. Do not reuse image output from the 2026-07-29 workspace.

- [ ] **Step 2: Record and transform generated assets**

Record the transparent product image as `product-image`. Record the regenerated `wear-layer` with `--generated`; this is the single generation-attempt counter for the cycle:

```bash
node scripts/wearit-images/batch.mjs record-asset \
  --workspace data/import-work/jackets-retry-20260730 \
  --item ITEM_ID --kind product-image --file WORKSPACE_STAGING_PRODUCT
node scripts/wearit-images/batch.mjs record-asset \
  --workspace data/import-work/jackets-retry-20260730 \
  --item ITEM_ID --kind wear-layer --file WORKSPACE_STAGING_WEAR --generated
```

- [ ] **Step 3: Inspect, optimize, and review**

Run:

```bash
node scripts/wearit-images/batch.mjs inspect --workspace data/import-work/jackets-retry-20260730 --item ITEM_ID
node scripts/wearit-images/batch.mjs optimize --workspace data/import-work/jackets-retry-20260730 --item ITEM_ID
node scripts/wearit-images/batch.mjs record-review --workspace data/import-work/jackets-retry-20260730 --item ITEM_ID --review REVIEW_JSON
```

The review JSON must contain all twelve rubric regions. Accept only when all local garment regions pass at confidence `>= 0.9`; global scale/position alone is not a local defect. On retry, obey the returned correction target and preserve list. Stop after the state machine accepts or quarantines the item, with at most three generated wear attempts.

- [ ] **Step 4: Verify terminal retry state**

Run:

```bash
node scripts/wearit-images/batch.mjs status --workspace data/import-work/jackets-retry-20260730
```

Expected: `total: 6`, `terminal: 6`, `failed-infrastructure: 0`.

### Task 3: Prepare the three wear-only corrections

- [ ] **Step 1: Copy the three processed sources into isolated correction intake**

Create `data/import-input/jackets-wear-corrections-20260730/Jackets/` and copy:

```text
/home/adam/Pictures/wearit-pilot/processed/Jackets/IMG_9741.jpg
/home/adam/Pictures/wearit-pilot/processed/Jackets/IMG_9752.jpg
/home/adam/Pictures/wearit-pilot/processed/Jackets/IMG_9845.jpg
```

- [ ] **Step 2: Create correction intake with stable IDs**

Create `data/import-work/jackets-wear-corrections-20260730/intake.json` with:

```json
[
  {"id":"896a4588-9f1a-489c-b6ab-0cc6ed90de6a","slug":"black-contrast-stitch-chore-jacket","name":"Black contrast-stitch chore jacket","sources":[{"file":"IMG_9741.jpg","role":"front"}]},
  {"id":"c818781f-6d24-4a54-88ae-2b16c9721c27","slug":"taupe-grey-tailored-blazer","name":"Taupe-grey tailored blazer","sources":[{"file":"IMG_9752.jpg","role":"front"}]},
  {"id":"128edd98-b035-409a-9271-60886b3e305f","slug":"distressed-brown-biker-jacket","name":"Distressed brown biker jacket","sources":[{"file":"IMG_9845.jpg","role":"front"}]}
]
```

- [ ] **Step 3: Initialize the correction workspace**

Run:

```bash
node scripts/wearit-images/batch.mjs init \
  --input data/import-input/jackets-wear-corrections-20260730/Jackets \
  --workspace data/import-work/jackets-wear-corrections-20260730 \
  --intake data/import-work/jackets-wear-corrections-20260730/intake.json
```

Expected: `total: 3`, `resumed: false`.

### Task 4: Regenerate only mannequin assets

- [ ] **Step 1: Preserve each accepted product image byte-for-byte**

Copy each existing selected product image into the correction workspace staging directory and record it without `--generated`. Verify its SHA-256 equals the previous selected product asset before continuing.

- [ ] **Step 2: Generate a corrected fit-master**

For each jacket, use the processed raw source and canonical mannequin. The generation instruction must explicitly require:

```text
Preserve the jacket's identity, material, seams, closures, pockets, color, and
silhouette. Fit it naturally to the canonical mannequin. The open negative
space between each inner arm and the side chest/torso is background, not jacket
fabric: render those gaps as clean chroma so they become genuine transparency.
Do not create opaque bridges, side panels, extra fabric, exposed mannequin
arms, or malformed cuffs.
```

Generate dual-chroma, remove both chroma colors with `remove-dual-chroma.py`, and record only the resulting `wear-layer` with `--generated`.

- [ ] **Step 3: Inspect, place, and apply twelve-region review**

Use the same `inspect`, `optimize`, and `record-review` commands as Task 2, but explicitly fail `torso`, `leftSleeve`, `rightSleeve`, or `artifacts` if the inner-arm gaps are opaque, contain invented fabric, or expose mannequin pixels.

- [ ] **Step 4: Verify alpha gaps independently**

Inspect the final wear layer on both light and dark checkerboards. The two underarm/side-chest openings must reveal both backgrounds continuously. A visual ambiguity is a failure and triggers another targeted wear generation, up to three attempts.

- [ ] **Step 5: Verify terminal correction state and product preservation**

Expected: `total: 3`, `accepted: 3`, `terminal: 3`, `failed-infrastructure: 0`; each accepted product-image SHA-256 matches its previous package asset.

### Task 5: Build web comparison and reports

- [ ] **Step 1: Generate both standard reports**

Run:

```bash
node scripts/wearit-images/batch.mjs report --workspace data/import-work/jackets-retry-20260730
node scripts/wearit-images/batch.mjs report --workspace data/import-work/jackets-wear-corrections-20260730
```

- [ ] **Step 2: Create `audit/comparison.html`**

Create a static page with one section per correction containing old preview, new preview, light-checkerboard alpha rendering, and dark-checkerboard alpha rendering. Add a retry section containing source, product, mannequin preview, terminal status, and QA reason for each of the six garments. Use relative file paths so the page works through a local static server.

- [ ] **Step 3: Validate every page reference**

Extract each local `src` and `href`, resolve it relative to the HTML file, and verify it exists and is non-empty. Expected: zero missing or empty references.

- [ ] **Step 4: Serve locally**

Run:

```bash
python3 -m http.server 4173 --directory data/import-work
```

Review URL:

```text
http://127.0.0.1:4173/jackets-wear-corrections-20260730/audit/comparison.html
```

### Task 6: Finalize and verify packages

- [ ] **Step 1: Finalize only after both workspaces are terminal**

Run:

```bash
node scripts/wearit-images/batch.mjs finalize \
  --workspace data/import-work/jackets-retry-20260730 \
  --repo . \
  --bundle data/import-bundles/jackets-retry-20260730
node scripts/wearit-images/batch.mjs finalize \
  --workspace data/import-work/jackets-wear-corrections-20260730 \
  --repo . \
  --bundle data/import-bundles/jackets-wear-corrections-20260730
```

- [ ] **Step 2: Verify bundle integrity**

For both bundles, parse `manifest.json`, verify every referenced file exists, require zero zero-byte files, reject symlinks, and confirm item counts match accepted state counts.

- [ ] **Step 3: Verify immutability and report outcome**

Confirm `data/import-bundles/jackets-autonomous-20260729` was not modified. Report accepted/quarantined counts, both bundle paths, and the comparison URL. Do not upload.
