---
name: import-clothes
description: Extract unique garments from outfit or model photos, reconstruct clean transparent clothing cutouts, and import approved items directly into this Wardrobe project's local JSON database. Use when a user asks Codex to add, ingest, extract, or import their clothes from a folder of photos into Wardrobe, or wants finished wardrobe PNGs without using the in-app OpenAI import flow.
---

# Import Clothes

Turn photos of worn clothing into source-faithful transparent catalog PNGs, then add the approved results to the local Wardrobe database.

## Inputs

Obtain the source-image folder unless the user already supplied it. Resolve relative paths from the repository root. Confirm this is the Wardrobe repository by checking for `package.json`, `scripts/import-job-api.mjs`, and `data/` in `.gitignore`.

Default to direct database import when the user asks to add clothes to Wardrobe. If they only request cutouts, ask for a new output-folder name instead and skip the database step.

## Rules

- Read and follow the built-in `imagegen` skill before generating or editing an image.
- Preserve every source image unchanged.
- Produce one clothing item per PNG, except an established matching pair such as shoes.
- Remove the wearer, skin, hair, mannequin, hanger, props, other layers, and scene.
- Preserve only source-supported color, material, silhouette, construction, pattern, and legible marks.
- Prefer omission over invented logos, text, pockets, seams, fasteners, hardware, or trim.
- Deduplicate only when source photographs establish that two appearances are the same physical item.
- Hold items whose defining construction cannot be recovered without substantial invention.
- Never place temporary crops, prompts, manifests, or QA files in `data/`.

## Temporary workspace

Work outside the repository data directory:

```bash
WORK="$(mktemp -d "${TMPDIR:-/tmp}/wardrobe-import.XXXXXX")"
mkdir -p "$WORK"/{source-jpg,crops,chroma,items,qa}
```

Keep all intermediate files under `$WORK`. Delete it only after delivery succeeds.

## Workflow

### 1. Inventory sources

Use `rg --files` first. Include JPEG, PNG, WebP, HEIC/HEIF, TIFF, BMP, and AVIF. Exclude `data/`, `dist/`, `node_modules/`, and `.git/`.

Create upright RGB JPEG working copies at quality 95 or better without upscaling. Make labeled contact sheets of at most 12 photos and inspect every sheet. Inventory every deliberately worn top, jacket, bottom, accessory, and pair of shoes.

### 2. Build the manifest

Write `$WORK/manifest.json` using this final shape:

```json
{
  "items": [
    {
      "slug": "navy-fair-isle-cardigan",
      "file": "navy-fair-isle-cardigan.png",
      "name": "Navy Fair Isle Cardigan",
      "part": "wholebody_up",
      "color": "#172033",
      "secondaryColor": "#f2efe6",
      "tags": ["knit", "fair isle", "zip"],
      "status": "accepted",
      "sourceRefs": ["IMG_1284.jpg", "IMG_1289.jpg"],
      "unknowns": []
    }
  ]
}
```

Use only these `part` values:

- `upperbody` — tops
- `wholebody_up` — jackets and outerwear
- `lowerbody` — bottoms
- `accessories_up` — accessories
- `shoes` — shoes

Use lowercase hyphenated slugs, six-digit hex colors, at most 12 short lowercase tags, and `null` when there is no genuinely distinct secondary color. Keep working records as `status: "generate"` or `status: "hold"`; change a record to `accepted` only after final QA. The import script ignores every non-accepted record.

### 3. Prepare focused references

For each generated item, crop the strongest view with about 12% padding and preserve enough context to distinguish the target from underlayers. Add at most one complementary crop when it shows important construction unavailable in the primary view. Inspect labeled crop contact sheets before generation.

### 4. Generate evidence-bound cutouts

Use Imagegen with the primary crop and only a genuinely complementary second crop. Ask for the complete empty item centered on a perfectly uniform chroma background with generous padding and no shadow. State the exact source-supported construction and all uncertain details that must be omitted.

Default to `#00ff00`; use `#ff00ff` for green garments unless magenta is prominent. Otherwise choose a maximally distant saturated RGB key. Never use a key color present in the garment.

Save generated chroma images to `$WORK/chroma/SLUG.png`. Compare every result against its source before accepting it.

### 5. Remove the chroma background

Prefer the helper bundled with the built-in Imagegen skill:

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/imagegen/scripts/remove_chroma_key.py" \
  --input "$WORK/chroma/SLUG.png" \
  --out "$WORK/items/SLUG.png" \
  --auto-key border \
  --soft-matte \
  --transparent-threshold 12 \
  --opaque-threshold 220 \
  --despill \
  --force
```

If removal damages the item, regenerate with a more distant key instead of forcing the matte.

### 6. Verify

For every final PNG, verify:

- PNG format with an RGBA alpha channel
- transparent corners and border
- visible content with padding and no clipped extremity
- no body part, underlayer, adjacent garment, prop, shadow, or chroma halo
- source-faithful category, proportions, color, material, construction, pattern, and marks
- exactly one output for every accepted manifest record

Inspect checkerboard contact sheets of at most 12 items and compare sensitive results individually with their source crops. Regenerate critical or major failures. Mark only passing records `accepted`.

### 7. Import into Wardrobe

Show the user the accepted item count and names before writing when their original request did not explicitly authorize direct import. When direct import was requested, proceed after QA.

Run the bundled deterministic importer from the repository root:

```bash
node .agents/skills/import-clothes/scripts/import-to-wardrobe.mjs \
  --items "$WORK/items" \
  --manifest "$WORK/manifest.json"
```

The script validates transparency, copies accepted PNGs into `data/imported/`, and atomically updates `data/library.json`. It derives stable UUIDs from image content, so rerunning an identical import updates metadata without creating duplicates.

Restart the dev server only if the running app does not pick up the database change, then verify the new item count at `/api/import/wardrobe` and visually inspect the gallery.

For cutout-only delivery, create the requested new child folder under the repository root and copy only accepted PNGs into it. Do not write the database.

## Finish

Return the imported count, skipped/held items, absolute database path, and gallery verification result. Display up to 12 final cutouts in chat. Mention any unrecoverable fragments briefly.
