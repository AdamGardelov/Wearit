# Jacket Placement Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce corrected local Wearit packages for three mannequin placements and accept Dark plum by explicit human override.

**Architecture:** Preserve the finalized packages as historical evidence. Create auditable successor state and bundle artifacts, regenerate only Taupe-grey's mannequin-dependent pixels, and use explicit placement values for Black and Distressed brown.

**Tech Stack:** Node.js Wearit batch tools, Sharp preview renderer, Python dual-chroma remover, built-in image generation, Vitest.

---

### Task 1: Lock full-canvas placement semantics

**Files:**
- Modify: `tests/wearit-images/placement.test.mjs`
- Modify: `scripts/wearit-images/placement.mjs`

- [ ] Add a focused test proving a locked `887x1774` wear layer remains at anchor `0.5, 0.5`, scale `1`, rotation `0`.
- [ ] Run `npx vitest run tests/wearit-images/placement.test.mjs --maxWorkers=1 --fileParallelism=false` and confirm the new test fails for the existing non-neutral selection.
- [ ] Implement the smallest locked-coordinate rule without changing placement for non-canonical inputs.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Regenerate Taupe-grey wear-only assets

**Files:**
- Create: `data/import-work/jackets-placement-corrections-20260730/**`

- [ ] Create a fresh isolated correction workspace from the canonical Taupe source while preserving the existing product identity and bytes.
- [ ] Generate one fit master and aligned dual-chroma render with transparent arm-to-torso gaps.
- [ ] Derive the wear layer deterministically and render neutral preview plus light/dark checkerboards.
- [ ] Record a conservative 12-region review; accept only if both gaps and cuffs are clean.

### Task 3: Apply explicit Black and Brown placements

**Files:**
- Create: `data/import-work/jackets-placement-corrections-20260730/**`

- [ ] Preserve the accepted Black and Brown product and wear assets byte-for-byte.
- [ ] Set Black placement to `0.50, 0.50, 1.00, 0`.
- [ ] Set Brown placement to `0.50, 0.50, 1.08, 0`.
- [ ] Render deterministic previews from the exact selected wear layers.

### Task 4: Accept Dark plum by human override

**Files:**
- Modify: `data/import-work/jackets-retry-20260730/run-state.json`
- Create: `data/import-work/jackets-retry-20260730/audit/dark-plum-human-override.json`

- [ ] Record the user's explicit acceptance with timestamp, selected asset hashes, and previous quarantine reason.
- [ ] Select the existing product and wear assets as accepted and change only Dark plum's terminal decision.
- [ ] Generate a corrected successor retry bundle without overwriting the historical bundle.

### Task 5: Compare, finalize, and verify

**Files:**
- Create: `data/import-work/jackets-placement-corrections-20260730/audit/comparison.html`
- Create: `data/import-bundles/jackets-placement-corrections-20260730/**`
- Create: `data/import-bundles/jackets-retry-20260730-corrected/**`

- [ ] Build a local comparison page showing old and corrected deterministic previews.
- [ ] Verify all references are contained, regular, nonzero files without symlinks.
- [ ] Run `npx vitest run tests/wearit-images/placement.test.mjs tests/wearit-images/decision.test.mjs tests/wearit-images/batch.test.mjs tests/wearit-images/finalize.test.mjs --maxWorkers=1 --fileParallelism=false`.
- [ ] Finalize the two successor bundles locally and confirm `uploaded: false`.
