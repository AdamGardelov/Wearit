# Wearit v2 package reference

## Paths and boundary

- Repository: `/home/adam/Dev/Lab/Wearit`
- Mannequin: `public/mannequin-photoreal.png`
- Dual-chroma reference: `assets/mannequin-dual-chroma.png`
- Repository tools: `scripts/wearit-images/`
- Workspace: `data/import-work/<batch-slug>/`
- Final package: `data/import-bundles/<batch-slug>/`

Generated and personal assets belong under the Git-ignored `data/` tree.
Prepare and validate a local package only. Never upload, open the site, call
Supabase, deploy, or request/use an API key.

## Fresh intake and state

The input path must be the canonical `unprocessed/Jackets` directory. Create a
new workspace for every fresh batch; `run-state.json` version 3 is authoritative
for resume. Never seed a new batch from previous generated output.

Each intake entry contains:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "slug": "navy-jacket",
  "name": "Navy jacket",
  "category": "jacket",
  "sources": [
    { "file": "navy-jacket/front.jpg", "role": "front" }
  ],
  "metadata": {
    "colors": ["#172033"],
    "tags": ["jacket", "navy"],
    "productImageId": "22222222-2222-4222-8222-222222222222"
  }
}
```

Rules:

- Item and `productImageId` values are stable version-4 UUIDs.
- Source files are relative to the input directory and cannot escape it.
- Require at least one six-digit hex color.
- Tags are lowercase, at most 40 characters each, and at most 12 total.
- A source belongs to exactly one item.

Initialize or resume the same state:

```bash
npm run wearit:batch -- init \
  --input /absolute/path/to/unprocessed/Jackets \
  --workspace /home/adam/Dev/Lab/Wearit/data/import-work/<batch-slug> \
  --intake /absolute/path/to/intake.json
```

Use the controller for all transitions:

```bash
npm run wearit:batch -- next --workspace <workspace>
npm run wearit:batch -- status --workspace <workspace>
```

## Locked dual-chroma derivation

After creating a fit master on the canonical mannequin, use `imagegen` to
render the same garment and fit on `assets/mannequin-dual-chroma.png`. Keep its
original `887x1774` canvas, green background, magenta mannequin, and coordinate
alignment unchanged. Do not allow key colors inside the garment.

Convert the render deterministically:

```bash
python3 scripts/wearit-images/remove-dual-chroma.py \
  --input <workspace>/candidates/<item>/dual-chroma.png \
  --out <workspace>/candidates/<item>/wear-layer.png
```

The wear layer must remain `887x1774` RGBA with visible and transparent pixels.
It shares the mannequin coordinate plane. Reject changed dimensions, holes,
blocky contours, key-color residue, mannequin pixels, or a deterministic
preview that differs from the intended fit.

Record generated files through the CLI so immutable copies and hashes enter
state. Use `--generated` exactly once for each candidate cycle, on the
`fit-master` record only:

```bash
npm run wearit:batch -- record-asset --workspace <workspace> \
  --item <item-id> --kind fit-master --file <fit-master> --generated
```

Product, dual-chroma, and wear-layer records do not use `--generated`.

## Deterministic inspection and preview

Run:

```bash
npm run wearit:batch -- inspect --workspace <workspace> --item <item-id>
npm run wearit:batch -- optimize --workspace <workspace> --item <item-id>
```

`optimize` renders candidates through
`scripts/wearit-images/render-preview.mjs` using Wearit's placement semantics:
stage-relative garment width, preserved aspect ratio, center anchoring, then
rotation. Only the preview created from the exact saved wear layer and selected
placement is review evidence. Never create a review preview with `imagegen`.

Neutral full-canvas placement is:

```json
{
  "anchorX": 0.5,
  "anchorY": 0.5,
  "scale": 1,
  "rotationDegrees": 0,
  "layerOrder": 20
}
```

## Version 2 reviewed manifest

Finalization writes `reviewed-items.v2.json` from accepted version-3 batch
state:

```json
{
  "version": 2,
  "items": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "Navy jacket",
      "category": "jacket",
      "wearLayerFile": "attempts/navy-jacket/wear-layer-v001.png",
      "images": [
        {
          "id": "22222222-2222-4222-8222-222222222222",
          "file": "attempts/navy-jacket/product-image-v001.png",
          "view": "front",
          "sortOrder": 0,
          "isPrimary": true
        }
      ],
      "colors": ["#172033"],
      "tags": ["jacket", "navy"],
      "placement": {
        "anchorX": 0.5,
        "anchorY": 0.5,
        "scale": 1,
        "rotationDegrees": 0,
        "layerOrder": 20
      },
      "status": "accepted"
    }
  ]
}
```

Only `status: "accepted"` items enter version 2. Quarantined items and Season
or Theme never enter the manifest.

## Reports and finalization

Create reports after every item is terminal:

```bash
npm run wearit:batch -- report --workspace <workspace>
```

The report includes machine-readable summaries, `review.html`, quarantine
evidence, and a reproducible 10% sample of accepted items (at least one when
anything is accepted).

Finalize with the repository-owned builder:

```bash
npm run wearit:batch -- finalize \
  --workspace <workspace> \
  --repo /home/adam/Dev/Lab/Wearit \
  --bundle /home/adam/Dev/Lab/Wearit/data/import-bundles/<batch-slug>
```

Finalization verifies the accepted-only bundle and its byte totals before
moving any sources. Only accepted, bundled sources move from the matching
`unprocessed/Jackets` path to `processed/Jackets`. Destinations are preflighted
and never overwritten. Quarantined, failed, pending, and unbundled sources stay
untouched. If validation fails, source movement does not begin.

The final package contains `manifest.json` and `assets/`. The user may later
select it manually in Wearit's import screen. This workflow never uploads it.

