# Jackets Retry and Mannequin Corrections Design

## Goal

Reprocess the eight images still in `unprocessed/Jackets` as a fresh autonomous batch, and replace only the mannequin assets for three already accepted jackets whose underarm and side-chest gaps were rendered as opaque garment material.

## Scope

The retry track reads all eight current files from:

`/home/adam/Pictures/wearit-pilot/unprocessed/Jackets`

Those files represent six garments. Earlier generated assets must not be reused as candidate output. Each garment may use at most three generation/review cycles and must finish as accepted or quarantined.

The correction track covers:

- `taupe-grey-tailored-blazer`
- `black-contrast-stitch-chore-jacket`
- `distressed-brown-biker-jacket`

Their accepted product images, stable IDs, source metadata, and product metadata are preserved. Only fit-master, dual-chroma, wear-layer, placement preview, and related review evidence are regenerated.

## Image Requirements

For the three corrected mannequin assets, the negative space between each arm and the side of the chest/torso must be genuine transparency in the wear layer. The regenerated garment must not contain a broad opaque bridge in those gaps, exposed mannequin arms, invented garment panels, or distorted cuffs.

For the retried six garments, upload-time scaling may compensate for a global size or position mismatch. It does not excuse local defects in shoulders, sleeves, cuffs, torso, hem, silhouette, or visible mannequin leakage. The autonomous twelve-region QA remains the acceptance gate.

## Processing Architecture

Use two non-destructive workspaces and final bundles:

1. A fresh autonomous retry workspace for the eight unprocessed source images.
2. A wear-only correction workspace for the three accepted jackets.

The previous finalized batch remains unchanged. The correction bundle retains each existing item ID so it can replace the affected assets without creating unrelated new garments.

All garment-pixel creation and editing uses the image generation workflow. Chroma removal and placement optimization use the repository's deterministic scripts.

## Visual Review

Generate a local static comparison page after processing. For each corrected jacket it shows:

- previous mannequin preview;
- corrected mannequin preview;
- corrected transparent wear layer on a light checkerboard;
- corrected transparent wear layer on a dark checkerboard.

For the six retried garments it shows the source, product image, mannequin preview, terminal status, and concise QA result. The page is evidence for batch review, not a manual per-item approval gate.

## Output and Safety

No upload is performed. Finalization happens only after every item is terminal. Accepted and quarantined totals, source dispositions, bundle paths, and the comparison page path are reported explicitly. Existing generated output and the original finalized package are never overwritten.

## Success Criteria

- All eight unprocessed images are consumed by a fresh six-garment run.
- Every retry item is accepted or quarantined within the attempt limit.
- All three correction wear layers contain genuine alpha transparency in the intended underarm and side-chest gaps.
- Product images and stable IDs for the three corrections are unchanged.
- The local comparison page loads all referenced images.
- Final bundles pass manifest, file-existence, zero-byte, and symlink checks.
