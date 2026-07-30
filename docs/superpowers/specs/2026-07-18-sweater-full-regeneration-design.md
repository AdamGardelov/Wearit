# Sweater Full Regeneration Design

## Goal

Regenerate the Grey Carin Wester logo sweatshirt through the current Wearit v2 image workflow. The existing WebP package reused an older flat wear layer and is not accepted as evidence of a mannequin fit.

## Source of truth

- Raw source: `/home/adam/Pictures/wearit-pilot/processed/Sweaters/IMG_9860.jpg`
- Canonical mannequin: `public/mannequin-photoreal.png`
- Locked chroma canvas: `/home/adam/.codex/skills/process-wearit-images/assets/mannequin-dual-chroma.png`
- Existing product cutout may be used only as a supporting fidelity reference. The raw photograph remains authoritative for the grey color, oversized silhouette, ribbed collar/cuffs/hem, seams, and exact `CARIN WESTER` embroidery.

## Regeneration flow

1. Preserve all existing accepted files and create versioned replacement candidates.
2. Generate a fit master on the unchanged canonical mannequin. The sweatshirt must drape as an intentionally oversized top: collar seated at the neck, shoulder seams dropped naturally, cuffs ending at the wrists, and ribbed hem around the upper hip. The mannequin, pose, canvas, lighting, and background stay unchanged.
3. Pause for visual approval of the fit master.
4. Render the approved garment and identical fit over the unchanged dual-chroma template using that template as the only reference canvas.
5. Run the deterministic dual-chroma remover to produce an exact 887x1774 transparent RGBA wear layer.
6. Render the review preview only with `render_mannequin_preview.mjs` at neutral exact-canvas placement: `anchorX: 0.5`, `anchorY: 0.5`, `scale: 1`, and `rotationDegrees: 0`.
7. Pause for approval of the deterministic preview. Reject any mismatch with the fit master, incorrect text, color or shape drift, mannequin residue, chroma holes, or rough edges.
8. Replace the reviewed manifest references only after approval, then run dry-run, build, final dry-run, and the focused import-package tests.

## Safety and validation

- Never overwrite the previously accepted assets until their versioned replacements are approved.
- Never upload or import anything.
- Keep the stable item and image UUIDs.
- The final product derivative remains transparent sRGB WebP; the wear layer remains optimized 887x1774 RGBA PNG.
- Mark the existing package stale while regeneration is in progress and do not report completion until the final dry run returns `changed: false` and all focused tests pass.
