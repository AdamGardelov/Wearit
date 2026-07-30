# Sweater Full Regeneration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old flat sweater wear layer with a reviewed fit-master-derived, dual-chroma-cleaned Wearit v2 layer and rebuild the local WebP bundle.

**Architecture:** Preserve the accepted files while producing versioned candidates in the existing `data/import-work/sweaters/` workspace. Image generation creates the fit master and locked dual-chroma render; deterministic scripts create the transparent layer and review preview; the existing builder creates and verifies the final package.

**Tech Stack:** Built-in image generation, PNG RGBA, Sharp, Python dual-chroma remover, Node mannequin compositor, Wearit v2 bundle builder, Vitest.

---

### Task 1: Mark the old package stale and prepare versioned paths

**Files:**
- Modify: `data/import-work/sweaters/run-state.json`
- Modify: `data/import-work/sweaters/progress.md`
- Create: `data/import-work/sweaters/fit-masters/grey-carin-wester-logo-sweatshirt-v2.png`
- Create: `data/import-work/sweaters/chroma-sources/grey-carin-wester-logo-sweatshirt-v2.png`
- Create: `data/import-work/sweaters/wear-layers/grey-carin-wester-logo-sweatshirt-v2.png`
- Create: `data/import-work/sweaters/mannequin-previews/grey-carin-wester-logo-sweatshirt-v2.png`

- [ ] **Step 1: Re-verify the processed source and all recorded accepted-asset checksums**

Run: `sha256sum /home/adam/Pictures/wearit-pilot/processed/Sweaters/IMG_9860.jpg data/import-work/sweaters/product-images/grey-carin-wester-logo-sweatshirt-front.png data/import-work/sweaters/wear-layers/grey-carin-wester-logo-sweatshirt.png`

Expected: all three values match `run-state.json`; otherwise stop on drift.

- [ ] **Step 2: Record regeneration state without changing accepted file references**

Set the batch stage to `generating_fit_master`, mark the existing package stale, add the four versioned candidate paths, and record that the old wear layer lacked fit-master and dual-chroma provenance. Regenerate `progress.md` with one item waiting for fit-master review.

- [ ] **Step 3: Confirm the accepted assets remain byte-for-byte unchanged**

Run the checksum command from Step 1 again.

Expected: the same three checksums.

### Task 2: Generate and review the canonical fit master

**Files:**
- Reference: `/home/adam/Pictures/wearit-pilot/processed/Sweaters/IMG_9860.jpg`
- Reference: `public/mannequin-photoreal.png`
- Reference: `data/import-work/sweaters/product-images-opaque/grey-carin-wester-logo-sweatshirt-front.png`
- Create: `data/import-work/sweaters/fit-masters/grey-carin-wester-logo-sweatshirt-v2.png`
- Modify: `data/import-work/sweaters/run-state.json`
- Modify: `data/import-work/sweaters/progress.md`

- [ ] **Step 1: Generate the fit master with built-in image generation**

Use the canonical mannequin as the edit target, the raw photo as garment truth, and the existing opaque product asset only as a supporting fidelity reference. Preserve the mannequin, pose, 887x1774 canvas, lighting, and background. Render the exact grey `CARIN WESTER` sweatshirt with its oversized silhouette, collar seated at the neck, dropped shoulders, cuffs at the wrists, and ribbed hem at the upper hip.

- [ ] **Step 2: Save non-destructively and validate the candidate**

Save as `fit-masters/grey-carin-wester-logo-sweatshirt-v2.png`. Verify dimensions, visually compare the exact text, color, silhouette, seams, ribbing, and fit against the raw source, and record its SHA-256.

- [ ] **Step 3: Pause for visual approval**

Show the fit master to the user. Do not create the dual-chroma render until the fit is accepted.

### Task 3: Derive and review the transparent wear layer

**Files:**
- Reference: `/home/adam/.codex/skills/process-wearit-images/assets/mannequin-dual-chroma.png`
- Reference: `data/import-work/sweaters/fit-masters/grey-carin-wester-logo-sweatshirt-v2.png`
- Create: `data/import-work/sweaters/chroma-sources/grey-carin-wester-logo-sweatshirt-v2.png`
- Create: `data/import-work/sweaters/wear-layers/grey-carin-wester-logo-sweatshirt-v2.png`
- Create: `data/import-work/sweaters/mannequin-previews/grey-carin-wester-logo-sweatshirt-v2.png`
- Modify: `data/import-work/sweaters/run-state.json`
- Modify: `data/import-work/sweaters/progress.md`

- [ ] **Step 1: Generate the locked dual-chroma render**

Use the dual-chroma template as the only reference canvas. Preserve its exact 887x1774 dimensions and coordinates while rendering the same approved garment and fit. Do not introduce green or magenta inside the garment.

- [ ] **Step 2: Remove chroma deterministically**

Run:

```bash
python3 /home/adam/.codex/skills/process-wearit-images/scripts/remove_dual_chroma.py \
  --input data/import-work/sweaters/chroma-sources/grey-carin-wester-logo-sweatshirt-v2.png \
  --out data/import-work/sweaters/wear-layers/grey-carin-wester-logo-sweatshirt-v2.png
```

Expected: an 887x1774 RGBA PNG with transparent and visible pixels, no mannequin residue, no garment holes, and a smooth antialiased edge.

- [ ] **Step 3: Render the deterministic preview**

Run:

```bash
node /home/adam/.codex/skills/process-wearit-images/scripts/render_mannequin_preview.mjs \
  --repo /home/adam/Dev/Lab/Wearit \
  --mannequin /home/adam/Dev/Lab/Wearit/public/mannequin-photoreal.png \
  --wear-layer data/import-work/sweaters/wear-layers/grey-carin-wester-logo-sweatshirt-v2.png \
  --output data/import-work/sweaters/mannequin-previews/grey-carin-wester-logo-sweatshirt-v2.png \
  --anchor-x 0.5 --anchor-y 0.5 --scale 1 --rotation-degrees 0
```

Expected: the preview matches the accepted fit master at neutral exact-canvas placement.

- [ ] **Step 4: Pause for deterministic-preview approval**

Show the raw source, fit master, transparent layer, and exact compositor preview. Do not change the manifest until accepted.

### Task 4: Promote the accepted layer and rebuild the bundle

**Files:**
- Modify: `data/import-work/sweaters/reviewed-items.v2.json`
- Modify: `data/import-work/sweaters/run-state.json`
- Modify: `data/import-work/sweaters/progress.md`
- Replace after approval: `data/import-bundles/sweaters/`

- [ ] **Step 1: Point the reviewed manifest at the accepted v2 wear layer**

Keep the stable item and image UUIDs, metadata, product image, and neutral placement unchanged. Change only `wearLayerFile` to `wear-layers/grey-carin-wester-logo-sweatshirt-v2.png`.

- [ ] **Step 2: Validate, build, and verify idempotence**

Run the skill-owned `build_bundle.mjs` with `--dry-run`, without it, then with `--dry-run` again.

Expected: one accepted item; byte totals for wear layers, product images, manifest, and total; final `"changed": false`.

- [ ] **Step 3: Run the focused package tests**

Run: `npm test -- tests/import/prepare-import-bundle.test.mjs`

Expected: all tests pass. If the sandbox blocks the nested CLI-wrapper process with `EPERM`, rerun the same command with approved elevated execution.

- [ ] **Step 4: Record completion**

Update run state and progress with final checksums, byte totals, test count, validation timestamp, and the unchanged processed source path. Report the exact local bundle path and state that nothing was uploaded.
