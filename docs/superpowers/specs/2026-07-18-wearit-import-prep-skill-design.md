# Wearit Import Preparation Skill Design

**Date:** 2026-07-18
**Status:** Approved in conversation
**Skill name:** `wearit-import-prep`

## Context

Wearit deliberately does not provide a self-service garment upload flow. Adam photographs and prepares garments locally with Codex, then imports a completed bundle into Wearit. The preparation process must produce the same professional visual style across batches, preserve real garment details, support optional front and back views, and create transparent layers suitable for the faceless mannequin.

The current process has several manual stages and can be interrupted. The new local Codex skill will make that process repeatable and resumable without introducing an OpenAI API dependency or changing the deployed application.

## Goals

- Turn folders of ordinary phone photographs into a validated Wearit v2 import bundle.
- Visually group photographs that belong to the same garment and identify their roles.
- Produce consistent, realistic product images and mannequin wear layers.
- Preserve garment shape, texture, colors, logos, printed text, and front/back identity.
- Pause for human approval before expensive image work and before finalization.
- Resume safely after interruption without regenerating accepted work.
- Track every item and stage in both machine-readable and human-readable form.
- Move successfully bundled source photographs from `unprocessed` to `processed`.

## Non-goals

- No wife-facing or public upload flow.
- No Supabase upload or mutation of the live wardrobe.
- No OpenAI API key or application-side AI integration.
- No person-specific face or body generation.
- No inference or bundling of Season or Theme. These are selected in Wearit's existing import review together with placement and scaling.
- No replacement of Wearit's existing v2 bundle validator or importer.

## Chosen approach

The skill uses a hybrid, checkpointed workflow:

- Codex performs visual grouping, image work, metadata proposals, placement inference, and correction work.
- Deterministic scripts own inventory, fingerprints, UUIDs, state transitions, reports, validation, bundle construction, and source-file movement.
- Human approval gates decide which proposed groups may be processed and which generated items may be finalized.

This division keeps the visual work flexible while making recovery and final output deterministic.

## Architecture

### Skill package

The local skill is installed as `wearit-import-prep`. It contains:

- `SKILL.md` with triggers, workflow, approval gates, and safety rules.
- Scripts for inventory, fingerprints, state management, progress rendering, review-sheet creation, validation orchestration, and source movement.
- Reference instructions for image style, mannequin use, metadata, category defaults, and visual quality checks.
- State and metadata templates where they reduce ambiguity.

The skill contains no API keys, personal photographs, or generated wardrobe assets.

### Batch workspace

Each run receives an input folder, a Wearit repository path, and a batch slug. It creates a dedicated working directory under Wearit's ignored data area. The logical layout is:

```text
data/import-work/<batch-slug>/
  run-state.json
  progress.md
  inventory/
  product-images-opaque/
  product-images/
  wear-layers/
  mannequin-previews/
  review/
  reviewed-items.v2.json
```

The validated final bundle is built under:

```text
data/import-bundles/<batch-slug>/
```

The implementation must confirm that working and bundle outputs are ignored by Git before placing generated or personal assets there.

### Existing Wearit integration

The skill targets the existing v2 contract and invokes Wearit's existing `scripts/prepare-import-bundle.mjs` builder and validator. It does not create a parallel bundle format. Explicit UUIDs are generated once and names are never used as IDs.

## Source inventory and identity

Input photographs may have ordinary phone filenames and may be arranged in category folders. A folder name is a category hint, not authoritative metadata.

For every source file, the inventory records:

- approved original path;
- current path;
- byte size;
- content checksum;
- proposed garment group;
- proposed front, back, or additional-view role.

At intake, Codex visually proposes garment groups and metadata. The complete proposal is shown before processing begins. Adam may regroup files, correct roles, rename garments, or correct metadata.

Once intake is approved:

- each garment receives a stable UUID;
- each product image receives a stable UUID;
- approved source membership and checksums are frozen in state;
- a changed, missing, or newly conflicting source causes a pause instead of an automatic guess.

The source photographs themselves are not copied merely to freeze a batch. Their paths and checksums provide drift protection.

## State and progress

`run-state.json` is the sole source of truth. It is updated atomically after every successful stage. At minimum it records:

- schema and skill version;
- batch identity, input path, repository path, and output paths;
- source inventory and checksums;
- item UUIDs, source grouping, and view roles;
- proposed and approved metadata;
- status of each image and validation stage;
- output paths and checksums;
- review decisions and requested corrections;
- current or last error with affected item and stage;
- original and processed source paths.

`progress.md` is regenerated from `run-state.json`; it is never maintained as a separate authority. It shows:

- completed items and stages;
- items waiting for intake or visual approval;
- requested corrections;
- failed stages and actionable errors;
- items not yet started;
- final bundle path when available.

The visible item states are:

1. discovered;
2. grouping pending approval;
3. intake approved;
4. product assets generated;
5. wear layer generated;
6. automatic checks passed;
7. visual review pending;
8. accepted, correction requested, or rejected;
9. included in validated bundle;
10. source moved to processed.

Detailed substages may exist in state, but the human report uses these stable labels.

## Processing workflow

### 1. Scan

The skill scans the selected `unprocessed` folder, inventories supported image files, calculates fingerprints, and compares them with any existing state. If the batch already exists, it verifies the recorded sources and resumes from the first incomplete stage.

### 2. Intake proposal and approval

Codex visually groups photographs into garments, identifies front/back/additional roles, and proposes:

- display name;
- Wearit category and mannequin slot;
- primary and secondary colors;
- descriptive tags;
- initial mannequin placement defaults.

The whole intake list is presented for approval. No product or wear images are generated before approval.

### 3. Generation waves

Approved garments are processed in waves of no more than ten. Each garment produces:

- faithful opaque front master and, when available, back master;
- transparent product cutouts for the supported views;
- one transparent mannequin wear layer;
- one mannequin preview used only for review;
- proposed v2 metadata and placement values.

The opaque master is retained as a trusted intermediate so background removal never becomes the only surviving version of garment details.

### 4. Automatic checks

Before visual review, deterministic checks verify file presence, formats, dimensions, alpha behavior, UUIDs, metadata shape, and source/output checksums. An item that fails stays in the current wave with an actionable error and is not offered as accepted.

### 5. Visual review

Each wave receives a local review sheet showing, per garment:

- source photographs;
- opaque front/back masters;
- transparent product front/back images;
- transparent wear layer;
- wear layer composed on the approved faceless mannequin;
- proposed name, category, colors, tags, and placement.

Adam can accept, reject, or request corrections for each garment. Corrections rerun only the affected garment and dependent preview. Accepted outputs cannot be overwritten without an explicit correction decision.

### 6. Bundle construction

After visual acceptance, the skill writes `reviewed-items.v2.json`, invokes Wearit's existing bundle preparation script, and requires a clean validation result. It then reports the exact bundle path. It never imports the bundle into Supabase or the live wardrobe.

### 7. Source movement

Only after an accepted item is present in a successfully validated bundle may its source photographs move from `unprocessed` to `processed`. The relative category structure is preserved by replacing the `unprocessed` path segment with `processed`.

The move must:

- create the destination category directory when needed;
- never overwrite an existing file;
- record the new path in state immediately;
- leave pending, failed, rejected, and unbundled sources untouched.

A destination collision pauses the move and records an actionable error.

## Image consistency contract

The skill uses a locked Wearit reference set consisting of:

- approved Wearit product images;
- the exact faceless mannequin;
- category-specific placement defaults;
- fixed instructions and review criteria.

Product-image requirements:

- realistic ecommerce-style presentation;
- no person, body, or mannequin in the product image;
- faithful silhouette and proportions;
- faithful fabric texture and construction details;
- exact visible logos, artwork, and text rather than invented substitutes;
- faithful colors, including small colored print details;
- transparent background in the final product cutout;
- garment pixels predominantly fully opaque, with partial alpha limited to legitimate soft edges or genuinely translucent material;
- no shadow or background haze encoded as broad garment translucency.

Wear-layer requirements:

- transparent RGBA PNG with both visible and transparent pixels;
- aligned to the approved faceless mannequin and the item's intended slot;
- realistic scale and silhouette;
- no mannequin pixels baked into the layer;
- placement metadata remains editable during Wearit import.

The mannequin preview is a review artifact only and is not substituted for a product image.

## Validation

Automatic validation includes:

- supported file formats and decodable files;
- required front product image and optional back image rules;
- exactly one primary front image;
- stable UUID format and uniqueness;
- valid Wearit categories, slots, colors, tags, and placement fields;
- all referenced assets exist inside the expected workspace;
- no unsafe paths or symlink escapes;
- wear-layer RGBA and meaningful visible/transparent pixel coverage;
- transparent product background and protection against broad accidental garment opacity loss;
- successful execution of Wearit's current v2 bundle validator;
- reproducible no-change result when rebuilding unchanged accepted state.

Visual approval remains required because deterministic alpha and schema checks cannot prove that a logo, printed word, texture, or silhouette is faithful.

## Resume and correction behavior

On every rerun, the skill:

1. loads and validates `run-state.json`;
2. verifies approved source fingerprints;
3. verifies checksums for completed outputs;
4. regenerates `progress.md`;
5. resumes at the first incomplete or explicitly reopened stage.

Completed and accepted stages are skipped when their files and checksums match. Missing or changed accepted outputs cause a pause rather than silent regeneration. Failed stages may be retried without restarting successful items.

If an interruption occurs during a state update, atomic replacement preserves the last complete state. Temporary output files are not treated as completed work.

## Privacy and safety

- All raw and generated images remain local unless Adam deliberately performs a separate deployment or import action.
- No API keys are requested or stored.
- The skill does not use a real person's face or body.
- Generated and personal assets must remain outside Git tracking.
- Source movement is delayed until bundle validation and never overwrites files.
- The skill reports exactly what it generated, moved, skipped, or could not complete.

## First forward test: Pants

The first real test uses:

```text
/home/adam/Pictures/wearit-pilot/unprocessed/Pants
```

The test must demonstrate:

1. inventory and visual grouping of the available Pants photographs;
2. intake approval before generation;
3. consistent product and wear assets;
4. a review pause with originals, outputs, mannequin previews, metadata, and placement;
5. a targeted correction without regenerating accepted garments;
6. a simulated interrupted run that resumes from recorded state;
7. successful v2 bundle validation;
8. reporting of the exact bundle path;
9. safe movement of only successfully bundled sources to the corresponding `processed/Pants` directory.

The test is not complete until both the automatic validator and Adam's visual review pass.

## Acceptance criteria

The design is successfully implemented when:

- invoking the skill with a supported raw folder consistently starts or resumes a batch;
- ordinary filenames do not become item IDs;
- front/back grouping and metadata require intake approval;
- generation runs in reviewable waves of at most ten garments;
- every item has durable, readable progress and machine state;
- accepted work survives interruption without unnecessary regeneration;
- source or output drift is detected and reported;
- product cutouts preserve garment opacity and detail;
- mannequin layers pass automatic checks and visual review;
- the existing Wearit v2 builder produces a validated bundle;
- Season and Theme remain wife-controlled import settings;
- only successfully bundled source photographs move to `processed`;
- no web upload, Supabase mutation, application AI, or API key is introduced.
