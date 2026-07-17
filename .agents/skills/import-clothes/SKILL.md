---
name: import-clothes
description: Use when a user asks Codex to prepare purpose-shot garment photos for Wearit's private authenticated Admin import.
---

# Import Clothes

Prepare source-faithful transparent garment cutouts and a deterministic Wearit handoff bundle. The bundle is derivatives only: raw photos and working crops remain local and outside it.

## Hard boundaries

- Start from a dedicated local folder of purpose-shot garment photos. One item per front photo; optional back/detail photos may clarify construction.
- Before extraction, confirm the owner consents to purpose-shot visual content being processed by Codex-managed built-in `imagegen`. Source files remain on local disk and outside Git, the repo, and the bundle; the referenced visual content is processed by that managed capability. If the owner requires strict on-device-only processing, stop and use a separate local background-removal workflow or accept already prepared RGBA cutouts.
- Read and use the built-in `imagegen` skill for consented cutout extraction. Do not add an API key, call an app-side AI endpoint, or use a repository import server.
- Never request or use a face, body, person, identity, or model reference. Never create photos of anyone wearing the clothes.
- Remove people, skin, hair, hangers, props, other garments, shadows, and backgrounds. Preserve only source-supported construction, material, color, pattern, marks, and proportions.
- Hold uncertain items locally. Do not invent hidden details or mark uncertain work accepted.
- Keep originals, crops, prompts, contact sheets, rejected work, and holds outside the final bundle. Never commit an import workspace.
- Do not write Supabase, Storage, or a local wardrobe database. The authenticated Admin screen owns review and upload.

## Review workspace

Create a temporary workspace outside the bundle with `reviewed/`, `working/`, and `qa/` directories. Preserve all source files unchanged. Inventory with `rg --files`, inspect every source, and deduplicate only when photos prove the same physical item.

Generate one complete item per transparent PNG (a shoe pair counts as one item). Require PNG RGBA, transparent border, visible pixels, no clipped extremity, clean matte, and no unrelated content. Use optional back/detail sources only to improve evidence-bound extraction. A reviewed detail derivative may be included only by explicitly listing it in the manifest.

## Categories and starting placement

Use these Admin-adjustable defaults; `rotationDegrees` is always `0`.

| Category | Slot | anchorX | anchorY | scale | layerOrder |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `top` | `top` | 0.50 | 0.32 | 0.56 | 30 |
| `bottom` | `bottom` | 0.50 | 0.66 | 0.58 | 20 |
| `dress` | `dress` | 0.50 | 0.50 | 0.70 | 30 |
| `jacket` | `outerwear` | 0.50 | 0.38 | 0.66 | 40 |
| `coat` | `outerwear` | 0.50 | 0.48 | 0.75 | 40 |
| `shoes` | `shoes` | 0.50 | 0.94 | 0.42 | 50 |
| `accessory` | `accessory` | 0.50 | 0.25 | 0.30 | 50 |

## Review manifest

Write a version 1 review manifest outside the final bundle. Each record uses a path relative to `reviewed/`:

```json
{
  "version": 1,
  "items": [{
    "file": "navy-cardigan.png",
    "detailFiles": ["details/navy-cardigan-back.webp"],
    "name": "Navy cardigan",
    "category": "jacket",
    "colors": ["#172033", "#f2efe6"],
    "tags": ["knit", "fair-isle", "zip"],
    "placement": { "anchorX": 0.5, "anchorY": 0.38, "scale": 0.66, "rotationDegrees": 0, "layerOrder": 40 },
    "status": "accepted"
  }]
}
```

Use `hold` until visual QA passes. Only `accepted` records enter the bundle. Use six-digit hex colors and at most 12 short tags.

## Build and hand off

Run dry-run first, then create the bundle:

```bash
node .agents/skills/import-clothes/scripts/import-to-wardrobe.mjs \
  --items "$WEARIT_REVIEWED_DIR" \
  --manifest "$WEARIT_REVIEW_MANIFEST" \
  --output "$WEARIT_BUNDLE_DIR" \
  --dry-run

node .agents/skills/import-clothes/scripts/import-to-wardrobe.mjs \
  --items "$WEARIT_REVIEWED_DIR" \
  --manifest "$WEARIT_REVIEW_MANIFEST" \
  --output "$WEARIT_BUNDLE_DIR"
```

The tool validates every accepted record before writing, assigns a stable content-derived UUID, and emits only `manifest.json` plus accepted assets. Re-run it safely after metadata or review changes.

Finish by reporting accepted and held counts, the bundle path, and any uncertainty. Direct the user to sign in, open Wearit's Admin import screen, align each cutout on the faceless mannequin, review, and import.
