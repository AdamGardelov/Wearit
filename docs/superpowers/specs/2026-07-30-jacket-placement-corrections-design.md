# Jacket Placement Corrections Design

## Goal

Correct the four user-reviewed jacket outcomes without overwriting historical
packages or uploading anything.

## Decisions

- Regenerate only Taupe-grey's mannequin-dependent assets. Preserve its accepted
  product image and require transparent arm-to-torso gaps.
- Keep Distressed brown intentionally oversized at scale `1.08`, but center it
  at anchor `0.50, 0.50`.
- Use the locked-coordinate neutral placement `0.50, 0.50, 1.00` for Black
  contrast-stitch.
- Accept Dark plum through an auditable human-review override using its existing
  product and wear assets.
- Write corrected bundles to new sibling paths; preserve the existing finalized
  bundles as immutable historical evidence.

## Validation

Render deterministic previews from the exact saved wear layers, inspect
arm-to-torso transparency on light and dark checkerboards, verify manifest
identity and hashes, and require the focused Wearit image tests to pass. Package
preparation remains local and performs no upload or deployment.
