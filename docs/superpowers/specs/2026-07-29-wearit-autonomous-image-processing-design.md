# Wearit Autonomous Image Processing Design

**Date:** 2026-07-29
**Status:** Approved in conversation
**Pilot category:** Jackets
**Workflow:** `process-wearit-images`

## Context

Wearit's current local image workflow can produce good product images and mannequin layers, but it depends on repeated manual review. The Jackets reprocessing pilot exposed the important failure mode: an image may pass file and transparency validation while the garment still fits the mannequin poorly. Typical defects include visible mannequin arms, uncovered wrists, shoulder gaps, incorrect sleeve proportions, and locally distorted cuffs.

Uniform scale and placement controls help when the entire layer is globally too large, small, high, or low. They cannot repair local geometric mismatches between the generated garment and the locked mannequin. Processing hundreds of garments therefore requires both automatic placement and semantic visual quality control.

The chosen design extends the local Codex workflow into a conservative autonomous pipeline. It automatically accepts only high-confidence items, retries targeted failures at most three times, and quarantines uncertain items without stopping the batch.

## Goals

- Process the raw images in `unprocessed/Jackets` without depending on per-item manual approval.
- Ignore all output from earlier processing attempts and create a separate pilot batch.
- Preserve the existing distinction between product images and mannequin wear layers.
- Optimize scale and placement automatically against the locked Wearit mannequin.
- Detect local fit defects that deterministic file validation cannot detect.
- Retry only the failed stage with a targeted correction.
- Auto-accept only high-confidence results.
- Quarantine uncertain or failed garments and continue the batch.
- Produce a local visual review site and machine-readable batch report.
- Resume interrupted processing without duplicate work.
- Validate accepted items with Wearit's existing v2 bundle preparation.
- Use a 10 percent random audit during the Jackets pilot to measure false acceptance.

## Non-goals

- No automatic upload to Supabase or mutation of the live wardrobe.
- No new deployed backend or application-side AI integration.
- No promise that uniform scaling can repair local garment geometry.
- No requirement that every garment must reach the import bundle.
- No automatic processing of categories other than Jackets in the first pilot.
- No movement or deletion of quarantined source images.
- No retraining or hosting of a custom segmentation or virtual try-on model.

## Chosen approach

The pipeline combines three independent controls:

1. deterministic structural validation;
2. automatic scale and placement optimization;
3. region-based multimodal visual review.

Every garment receives one of three decisions:

- **accept** when every critical control passes with high confidence;
- **retry** when a classified defect has a supported targeted correction and the retry budget remains;
- **quarantine** when confidence is insufficient, the defect is unsupported, or three generation attempts have failed.

The batch never waits for a manual per-item decision. Quarantine is a valid final outcome.

## Architecture

### Execution boundary

The automation remains part of the local `process-wearit-images` Codex workflow. Image generation and visual judgment use Codex's built-in image capabilities. Deterministic scripts own inventory, hashing, state transitions, placement search, image inspection, reports, bundle preparation, and resume behavior.

The deployed Wearit application remains unchanged. Its existing placement controls stay available for optional import-time adjustment, but the autonomous pipeline must not rely on a person correcting every accepted item.

### Batch workspace

Each run creates a new batch workspace rather than reading or modifying earlier processed output:

```text
data/import-work/<batch-slug>/
  run-state.json
  accepted/
    product-images/
    wear-layers/
    mannequin-previews/
    reviewed-items.v2.json
  quarantine/
    <item-slug>/
      sources/
      candidates/
      report.json
  audit/
    review.html
    contact-sheets/
    sample.json
  attempts/
    <item-slug>/
      attempt-01/
      attempt-02/
      attempt-03/
  reports/
    batch-report.json
    batch-report.md
```

The final validated import bundle is built under the existing ignored bundle area. Generated images and private source material must remain ignored by Git.

### Item state

`run-state.json` is the sole state authority and is updated atomically after every completed stage. An item records:

- stable item ID and slug;
- source paths, content hashes, and inferred image roles;
- generated asset paths and hashes;
- current stage and terminal decision;
- placement candidates and selected placement;
- deterministic check results;
- region-level visual scores and explanations;
- classified defects;
- retry number, requested correction, and outcome;
- quarantine reason when applicable;
- bundle inclusion and audit selection.

Terminal item states are `accepted`, `quarantined`, and `failed-infrastructure`. An infrastructure failure pauses the run because continuing could invalidate the whole batch. A garment-quality failure quarantines only that garment and continues.

## Processing flow

### 1. Intake and isolation

The pipeline scans only the explicitly selected `unprocessed/Jackets` source directory. It computes content hashes and creates a fresh batch manifest. Existing processed folders, earlier import-work batches, and previous generated assets are not candidates for reuse.

Within the new batch, hashes provide idempotency. Restarting the same batch skips stages whose recorded inputs and output hashes still match. Changed or missing source files produce an explicit item error rather than silent reuse.

### 2. Initial asset generation

For each garment, the workflow produces:

- a faithful product-image master;
- a transparent product image;
- a mannequin-fit master based on the locked reference geometry;
- a transparent mannequin wear layer;
- a deterministic preview composed on the exact locked mannequin.

Product and wear assets have independent acceptance state. If the product image passes but the wear layer fails, subsequent attempts preserve the accepted product image.

### 3. Deterministic structural checks

Before visual judgment, scripts verify:

- expected file presence, format, dimensions, and color mode;
- usable alpha with both visible and transparent pixels where required;
- exact coordinate plane for mannequin layers;
- absence of broad chroma residue and suspicious edge colors;
- connected-component limits for detached pixel islands;
- output hashes and metadata shape;
- successful deterministic composition on the locked mannequin;
- compatibility with the existing v2 bundle validator.

A structural failure never reaches auto-accept. Repairable cleanup failures may be retried without new image generation.

### 4. Automatic placement optimization

The optimizer searches Wearit's supported uniform `scale`, `anchorX`, and `anchorY` values. Rotation remains fixed unless a later category-specific design explicitly enables it.

The search is coarse-to-fine:

1. evaluate a bounded grid around category defaults;
2. retain the strongest candidates;
3. refine scale and anchors around those candidates;
4. render deterministic previews for the finalists;
5. pass the best preview and nearby alternatives to the visual quality gate.

The objective favors expected torso coverage and symmetry while penalizing exposed mannequin regions, clipping, implausible garment bounds, and deviation from category placement defaults. Placement optimization may correct global geometry only; it must not classify an irreparable local mismatch as fixed.

### 5. Region-based visual quality gate

The visual judge compares the source photographs, product image, fit master, wear layer, and final deterministic preview. It returns structured results for:

- source fidelity and garment identity;
- collar and neckline;
- left and right shoulder transitions;
- left and right sleeves;
- left and right cuffs and wrists;
- torso fit and side seams;
- hem and garment length;
- visible mannequin skin or body;
- residue, holes, detached pixels, and other artifacts.

Each critical region receives `pass`, `fail`, or `uncertain`, a confidence value, and a short reason. Acceptance requires:

- all deterministic checks passing;
- no critical region marked `fail`;
- no critical region marked `uncertain`;
- overall source fidelity passing;
- confidence above the configured conservative threshold.

An aggregate score cannot compensate for a local critical failure. In particular, any visible mannequin arm at a sleeve opening, uncovered wrist caused by bad fit, shoulder gap, or material pixel artifact blocks acceptance.

To reduce judge variance, the same acceptance rubric and structured schema are used for every item. The pilot report retains the judgment evidence so threshold errors can be audited.

## Targeted retries

The retry controller maps classified defects to the smallest useful correction:

| Defect | Correction |
| --- | --- |
| Global size or vertical position | Re-run placement optimization |
| Chroma residue or detached pixel island | Re-run deterministic cleanup |
| Visible mannequin arm | Regenerate the affected sleeve with explicit coverage constraints |
| Uncovered or malformed wrist | Regenerate the affected cuff and sleeve end |
| Shoulder gap or bad sleeve transition | Regenerate shoulder and upper-sleeve geometry |
| Incorrect torso width or hem length | Regenerate the fit master with targeted torso constraints |
| Poor source fidelity | Regenerate from the approved source set |

The controller preserves stages that have already passed. Every attempt is versioned and immutable. The visual judge evaluates a newly rendered deterministic preview after each correction.

The maximum is three generation attempts per garment, including the initial generation. Deterministic placement or cleanup passes do not consume a generation attempt unless they invoke image generation. When no supported correction exists or the third attempt still fails, the garment is quarantined.

## Quarantine

Quarantine is designed for diagnosis, not as an opaque rejection bucket. Each quarantined item contains:

- source thumbnails;
- the latest product and wear candidates;
- the final mannequin preview;
- a contact sheet of all attempts;
- failed and uncertain regions;
- the final defect classification;
- corrections already attempted;
- machine-readable scores and reasons;
- a suggested manual next action.

Quarantined items are excluded from `reviewed-items.v2.json` and the final bundle. Their source files remain in `unprocessed/Jackets`. The batch proceeds immediately to the next garment.

## Local visual review

The batch generates a static local `review.html` with:

- accepted and quarantined totals;
- acceptance, quarantine, and infrastructure-failure rates;
- thumbnails of accepted items and their mannequin previews;
- prominent region-level reasons for quarantined items;
- attempt history per quarantined garment;
- a dedicated 10 percent random sample of accepted items.

The page is a review artifact, not a control plane. Editing files or clicking decisions in it is not required for the batch to finish.

## Audit and calibration

For the Jackets pilot, 10 percent of auto-accepted garments are selected reproducibly from the batch manifest. The sample is large enough to include at least one item whenever the batch has accepted items.

The audit checks the same critical regions as the automated gate. Any critical false acceptance means the acceptance threshold or rubric must be tightened and affected accepted items re-evaluated before expanding to another category.

The pilot is successful when:

- no critical fit failure appears in the audit sample;
- visible mannequin arms, bad wrist coverage, major shoulder gaps, and significant pixel residue are stopped;
- every garment reaches a terminal decision without per-item intervention;
- no garment exceeds three generation attempts;
- every quarantine decision has an understandable reason;
- the accepted bundle passes the existing v2 validator;
- interrupted execution resumes without duplicate generation.

The expected quarantine rate is not a hard target. A rate around 10–20 percent is acceptable initially, but safety takes precedence over throughput.

## Error handling

Errors are divided into two classes:

- **item-quality errors** affect one garment and lead to retry or quarantine;
- **infrastructure errors** threaten state integrity or all subsequent output and pause the batch.

Infrastructure errors include an unreadable state file, failure to atomically persist state, missing locked references, unavailable image-generation capability, and failure of the bundle validator itself. The report identifies the exact resumable stage after the issue is corrected.

No accepted asset is overwritten. A correction creates a new version and updates the selected-version pointer only after checks pass.

## Bundle construction

Only accepted items are written to the reviewed-items manifest. The workflow invokes the existing `scripts/prepare-import-bundle.mjs` path rather than defining another import format. A clean validator result is required before reporting the bundle as ready.

The automation stops at a local validated bundle. Upload and final wardrobe mutation remain explicit actions outside `process-wearit-images`.

## Rollout

1. Run the autonomous workflow against a new Jackets-only batch.
2. Inspect every quarantined item and the 10 percent accepted audit sample through the local review page.
3. Measure critical false accepts, false quarantines, retry distribution, runtime, and generation attempts.
4. Tighten thresholds or defect instructions if the audit reveals a critical false accept.
5. Repeat the Jackets pilot until the acceptance criteria hold.
6. Design category-specific defaults and calibration before enabling another category.

## Key design risk

Multimodal judgment is probabilistic. The design reduces, but cannot mathematically eliminate, false acceptance. Conservative thresholds, explicit critical-region vetoes, retained evidence, and the initial manual sample audit are therefore required before treating the process as safe for unattended high-volume use.
