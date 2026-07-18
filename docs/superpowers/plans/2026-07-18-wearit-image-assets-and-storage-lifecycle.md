# Wearit Image Assets and Storage Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate deterministic optimized garment assets, clean obsolete Supabase versions safely, update the processing skill, and rebuild the seven reviewed pants items without jagged edges.

**Architecture:** Wearit's existing bundle builder remains the boundary that turns reviewed local sources into uploadable derivatives. The repository keeps immutable versioned uploads, captures prior database references before replacement, and cleans those references only after the import RPC commits; existing orphan reconciliation remains the fallback. The local image skill owns the full-canvas dual-chroma workflow and produces canonical `887x1774` wear-layer sources with neutral placement.

**Tech Stack:** Node.js ESM, Sharp, Vitest, React, Supabase Storage/RPC, Python 3, Pillow, Codex skills.

---

## File map

- `scripts/prepare-import-bundle.mjs`: validate canonical wear layers, create optimized PNG/WebP derivatives, produce deterministic asset names, and report byte totals.
- `tests/import/prepare-import-bundle.test.mjs`: exercise real Sharp output and bundle summaries.
- `src/data/wardrobeRepository.js`: capture old v2 image references and remove them after a committed replacement.
- `src/data/wardrobeRepository.test.js`: prove success, rollback, and cleanup-warning transaction boundaries.
- `/tmp/process-wearit-images-softmatte.IvOL3E/`: staged skill copy used for TDD and validation before installation.
- `/home/adam/.codex/skills/process-wearit-images/`: installed skill updated only after staged validation.
- `data/import-work/pants/`: reviewed chroma sources, regenerated wear layers/previews, and v2 manifest.
- `data/import-bundles/pants/`: rebuilt import package.

### Task 1: Deterministic v2 image derivatives

**Files:**
- Modify: `tests/import/prepare-import-bundle.test.mjs`
- Modify: `scripts/prepare-import-bundle.mjs`

- [ ] **Step 1: Write failing builder tests**

Add tests that create a canonical `887x1774` RGBA wear layer and a transparent
`1800x900` PNG product source. Assert that the v2 bundle emits:

```js
expect(item.wearLayerFile).toBe(`assets/${ITEM_ID}/wear-layer.png`);
expect(item.images[0].file).toBe(`assets/${ITEM_ID}/images/${FRONT_ID}.webp`);

const product = sharp(path.join(outputDir, item.images[0].file));
expect(await product.metadata()).toMatchObject({
  format: "webp",
  width: 1600,
  height: 800,
  hasAlpha: true,
  space: "srgb",
});
expect((await product.extract({ left: 0, top: 0, width: 1, height: 1 })
  .raw().toBuffer())[3]).toBe(0);
```

Add a second test proving a smaller image is not enlarged, the optimized wear
layer stays `887x1774` RGBA with transparent and visible pixels, and output
metadata is stripped.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- tests/import/prepare-import-bundle.test.mjs
```

Expected: failures because product files retain their source extension/bytes,
large sources are not resized, and canonical dimensions are not required.

- [ ] **Step 3: Implement minimal derivative helpers**

In `scripts/prepare-import-bundle.mjs`, add constants and helpers equivalent to:

```js
const MANNEQUIN_WIDTH = 887;
const MANNEQUIN_HEIGHT = 1774;
const PRODUCT_MAX_EDGE = 1600;

async function prepareWearLayer(file, label) {
  const input = sharp(await readFile(file));
  const metadata = await input.metadata();
  if (metadata.format !== "png" || metadata.width !== MANNEQUIN_WIDTH
      || metadata.height !== MANNEQUIN_HEIGHT || !metadata.hasAlpha
      || metadata.channels !== 4) {
    throw new Error(`${label} must be an 887x1774 RGBA PNG`);
  }
  const alpha = (await input.stats()).channels[3];
  if (!alpha || alpha.min !== 0 || alpha.max === 0) {
    throw new Error(`${label} must contain transparent and visible pixels`);
  }
  return sharp(await readFile(file)).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

async function prepareProductImage(file, label) {
  const bytes = await readFile(file);
  const input = sharp(bytes);
  const metadata = await input.metadata();
  if (!DETAIL_FORMATS.has(metadata.format) || !metadata.width || !metadata.height) {
    throw new Error(`${label} must be a PNG, JPEG, or WebP image`);
  }
  const alpha = metadata.hasAlpha ? (await input.stats()).channels.at(-1) : null;
  if (!alpha || alpha.min !== 0 || alpha.max === 0) {
    throw new Error(`${label} product image must contain transparent and visible pixels`);
  }
  return sharp(bytes, { failOn: "error" })
    .autoOrient()
    .resize(PRODUCT_MAX_EDGE, PRODUCT_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .toColorspace("srgb")
    .webp({ quality: 88, alphaQuality: 100 })
    .toBuffer();
}
```

Use `assets/<item-id>/images/<image-id>.webp` for v2 output and retain the
existing v1 behavior.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the same Vitest command. Expected: all builder tests pass.

- [ ] **Step 5: Commit the builder checkpoint**

```bash
git add scripts/prepare-import-bundle.mjs tests/import/prepare-import-bundle.test.mjs
git commit -m "feat: build optimized wardrobe image derivatives"
```

### Task 2: Full-canvas placement preservation and byte reporting

**Files:**
- Modify: `tests/import/prepare-import-bundle.test.mjs`
- Modify: `scripts/prepare-import-bundle.mjs`

- [ ] **Step 1: Write failing summary test and placement regression coverage**

Add v2 coverage proving the neutral transform passes through unchanged:

```js
expect(item.placement).toEqual({
  anchorX: 0.5,
  anchorY: 0.5,
  scale: 1,
  rotationDegrees: 0,
  layerOrder: 20,
});
```

Keep the existing numeric placement validation so an explicitly reviewed small
correction remains legal. Category-based cropped-image defaults are prevented by
the processing skill, which owns manifest creation, rather than by rejecting
reviewed corrections in the builder.

Add a successful test asserting:

```js
expect(result.bytes).toEqual({
  wearLayers: expect.any(Number),
  productImages: expect.any(Number),
  manifest: expect.any(Number),
  total: expect.any(Number),
});
expect(result.bytes.total).toBe(
  result.bytes.wearLayers + result.bytes.productImages + result.bytes.manifest,
);
```

- [ ] **Step 2: Run focused tests and verify RED**

Expected: `result.bytes` is missing. The placement assertion documents existing
pass-through behavior and must stay green.

- [ ] **Step 3: Implement summary accounting**

Calculate output byte counts from the prepared buffers and serialized manifest;
return the same summary from real builds and dry-runs.

- [ ] **Step 4: Run focused tests and verify GREEN**

Expected: all builder tests pass, including deterministic second dry-run.

- [ ] **Step 5: Commit the contract checkpoint**

```bash
git add scripts/prepare-import-bundle.mjs tests/import/prepare-import-bundle.test.mjs
git commit -m "feat: enforce canonical wear layer contract"
```

### Task 3: Safe cleanup of replaced Supabase objects

**Files:**
- Modify: `src/data/wardrobeRepository.test.js`
- Modify: `src/data/wardrobeRepository.js`

- [ ] **Step 1: Write failing repository tests**

Add tests with an existing item and image rows that assert:

```js
expect(remove).toHaveBeenCalledWith([oldWearPath, oldFrontPath]);
expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
```

Add an RPC-failure test asserting old paths are not removed and only the newly
uploaded paths are rolled back. Add a cleanup-failure test asserting the import
remains committed and returns:

```js
expect(result).toMatchObject({
  committed: true,
  cleanupWarning: expect.stringMatching(/old.*images/i),
});
```

- [ ] **Step 2: Run repository tests and verify RED**

Run:

```bash
npm test -- src/data/wardrobeRepository.test.js
```

Expected: no query captures prior structured image paths and no post-commit
remove call occurs.

- [ ] **Step 3: Implement prior-path capture and best-effort cleanup**

Before upload, query the owner-scoped item `cutout_path` and its
`wardrobe_item_images.storage_path` rows. After a successful RPC, remove unique
prior paths that differ from all new paths. Preserve committed state and attach
a cleanup warning if Storage removal fails. Keep the existing pre-commit
rollback behavior unchanged.

- [ ] **Step 4: Run repository tests and verify GREEN**

Expected: all repository transaction-boundary tests pass.

- [ ] **Step 5: Commit the lifecycle checkpoint**

```bash
git add src/data/wardrobeRepository.js src/data/wardrobeRepository.test.js
git commit -m "fix: clean replaced wardrobe image versions"
```

### Task 4: Update and install the processing skill

**Files:**
- Modify: `/tmp/process-wearit-images-softmatte.IvOL3E/tests/test_remove_dual_chroma.py`
- Modify: `/tmp/process-wearit-images-softmatte.IvOL3E/scripts/remove_dual_chroma.py`
- Modify: `/tmp/process-wearit-images-softmatte.IvOL3E/SKILL.md`
- Modify: `/tmp/process-wearit-images-softmatte.IvOL3E/references/wearit-v2.md`

- [ ] **Step 1: Verify the chroma regression test is RED on the old remover**

Run the single two-pixel-fringe test against the unmodified installed script.
Expected: the protruding edge alpha differs materially from the normal edge.

- [ ] **Step 2: Finish the minimal matte fix and verify GREEN**

Use a two-pixel alpha contraction, a soft feather, and edge-only green/magenta
despill. Run:

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Expected: all skill tests pass.

- [ ] **Step 3: Update the skill contract**

Document canonical `887x1774` full-canvas PNG wear layers, neutral transform,
builder-created transparent WebP product derivatives, metadata removal,
lossless PNG optimization, bundle byte reporting, and the rule that the skill
never uploads to Supabase.

- [ ] **Step 4: Validate and install**

Run the skill validator against the staged directory. Copy the validated staged
files over `/home/adam/.codex/skills/process-wearit-images/`, then rerun the
validator and tests from the installed location.

### Task 5: Reprocess all seven pants and rebuild

**Files:**
- Modify: `data/import-work/pants/wear-layers/*.png`
- Modify: `data/import-work/pants/mannequin-previews/*.png`
- Modify: `data/import-work/pants/reviewed-items.v2.json`
- Modify: `data/import-bundles/pants/**`

- [ ] **Step 1: Regenerate all wear layers**

Run the installed dual-chroma remover for each reviewed source in
`data/import-work/pants/perfect-fit-candidates/chroma-sources/`, writing the
corresponding canonical file under `wear-layers/`.

- [ ] **Step 2: Normalize reviewed placements and render previews**

Set each v2 placement to `anchorX: 0.5`, `anchorY: 0.5`, `scale: 1`, and
`rotationDegrees: 0`, preserving category layer order. Render every preview with
the deterministic compositor.

- [ ] **Step 3: Visually inspect all seven results**

Confirm smooth outer contours, no green/magenta spill, no fabric holes, correct
waist/leg shapes, and exact fit alignment on the canonical mannequin.

- [ ] **Step 4: Build and prove determinism**

Run dry-run, real build, and dry-run again. Expected final result:
`changed: false`, seven accepted items, WebP product assets, optimized PNG wear
layers, and byte totals by class.

- [ ] **Step 5: Run final verification**

```bash
npm test -- tests/import/prepare-import-bundle.test.mjs src/data/wardrobeRepository.test.js src/features/admin/importBundle.test.js
npm test
npm run build
python3 -m unittest discover -s /home/adam/.codex/skills/process-wearit-images/tests -p 'test_*.py' -v
```

Expected: all commands exit successfully with no new warnings attributable to
the change.
