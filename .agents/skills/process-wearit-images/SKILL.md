---
name: process-wearit-images
description: Use when local raw clothing photos must become a Wearit v2 import package, when a garment-image batch needs to resume, or when Wearit product images and mannequin layers need preparation.
---

# Process Wearit Images

## Purpose

Turn local raw garment photos into a reviewed, validated Wearit v2 package.

**Hard boundary:** prepare the local package only. Never open the site, upload
files, call Supabase, mutate wardrobe data, deploy, or request/use an API key.

Before processing, read:

- `references/wearit-v2.md`
- `references/autonomous-qa-rubric.md` in autonomous mode

**REQUIRED SUB-SKILL:** Use `imagegen` for every garment pixel generation or
edit. Use repository scripts only for deterministic dual-chroma removal,
inspection, placement previews, reports, and finalization. Never generate or
improve a review preview with `imagegen`.

## Modes

- **interactive**: default for an ordinary small batch. Propose intake before
  generation and pause for item review.
- **autonomous-conservative**: use when the user requests automation,
  unattended processing, or no per-item review. Do not pause for intake or
  per-item decisions. Automatically accept only high-confidence items, retry
  targeted defects, quarantine unresolved items, and continue.

The invocation accepts `--path`, `--path-to-folder`, or a bare absolute path. If
no path is supplied, ask only for the path.

## Autonomous-conservative workflow

Run every command from the Wearit repository root.

1. **Create fresh intake**
   - Recursively inspect only the requested source folder and group views by
     physical garment, never by filename alone.
   - Ignore all earlier generated output. Choose a new workspace under
     `data/import-work/`; resume only that exact workspace after verifying its
     source hashes. Never import assets from an older workspace or package.
   - Write an intake JSON array. Every item has a stable UUID `id`, slug,
     display `name`, `category: "jacket"`, relative `sources` with roles, and
     complete metadata:

     ```json
     {
       "id": "item-v4-uuid",
       "slug": "navy-jacket",
       "name": "Navy jacket",
       "category": "jacket",
       "sources": [{ "file": "navy/front.jpg", "role": "front" }],
       "metadata": {
         "colors": ["#172033"],
         "tags": ["jacket", "navy"],
         "productImageId": "product-image-v4-uuid"
       }
     }
     ```

   - Initialize:

     ```bash
     npm run wearit:batch -- init \
       --input /absolute/path/to/unprocessed/Jackets \
       --workspace /absolute/path/to/repo/data/import-work/<fresh-batch> \
       --intake /absolute/path/to/repo/data/import-work/<fresh-batch>-intake.json
     ```

2. **Drive the state machine**

   ```bash
   npm run wearit:batch -- next --workspace <workspace>
   ```

   Obey the returned `action`. Process one item to a terminal result, then call
   `next` again. A quarantined item is terminal for that item, not for the
   batch.

3. **Generate one candidate cycle**
   - Use `imagegen` with the recorded raw sources to create:
     1. a faithful transparent front product cutout when not already accepted;
     2. a fit master of the canonical mannequin wearing the garment;
     3. the same accepted fit on `assets/mannequin-dual-chroma.png`, with the
        canvas and key colors unchanged outside the garment.
   - Run the repository remover on the dual-chroma render:

     ```bash
     python3 scripts/wearit-images/remove-dual-chroma.py \
       --input <workspace>/candidates/<item>/dual-chroma.png \
       --out <workspace>/candidates/<item>/wear-layer.png
     ```

   - Record every candidate as an immutable batch asset:

     ```bash
     npm run wearit:batch -- record-asset --workspace <workspace> \
       --item <item-id> --kind product-image --file <product-file>
     npm run wearit:batch -- record-asset --workspace <workspace> \
       --item <item-id> --kind fit-master --file <fit-file> --generated
     npm run wearit:batch -- record-asset --workspace <workspace> \
       --item <item-id> --kind dual-chroma --file <dual-chroma-file>
     npm run wearit:batch -- record-asset --workspace <workspace> \
       --item <item-id> --kind wear-layer --file <wear-layer-file>
     ```

   **Generation counting is strict:** use `--generated` exactly once per
   candidate generation cycle, when recording `fit-master`. Do not put it on
   product, dual-chroma, or wear-layer records. The initial cycle counts as
   candidate 1; never exceed three candidates.

   On a wear-only correction, keep the accepted product image and generate only
   the dependent fit master, dual-chroma render, and wear layer. Never record a
   replacement product unless `next` explicitly requests source-fidelity or
   product regeneration.

4. **Inspect and optimize**

   ```bash
   npm run wearit:batch -- inspect --workspace <workspace> --item <item-id>
   npm run wearit:batch -- optimize --workspace <workspace> --item <item-id>
   ```

   Inspect structural output before optimization. The optimizer's preview is
   deterministic and is the import truth.

   Never claim scaling fixed a local fit defect. Scaling can correct only a
   globally large/small/high/low layer. If either sleeve, cuff, shoulder, torso,
   or hem is locally wrong, classify that region and regenerate only dependent
   wear assets.

5. **Review without a human pause**
   - Visually inspect the raw sources, product image, fit master, exact
     deterministic preview, and relevant attempt history.
   - Create the exact JSON defined in
     `references/autonomous-qa-rubric.md`. One failed, uncertain, or
     low-confidence critical region vetoes acceptance.
   - Record it:

     ```bash
     npm run wearit:batch -- record-review --workspace <workspace> \
       --item <item-id> --review <workspace>/reviews/<item>-review.json
     ```

   - Obey the returned decision:
     - `accept`: continue to `next`;
     - `retry`: follow the correction and preserve list returned by `next`;
     - `quarantine`: retain all evidence, exclude the item from the package,
       and continue immediately to `next`;
     - `stop`: stop only for an infrastructure failure.

   Never substitute aggregate quality for the region veto. Never turn an
   unclear region into `pass`.

6. **Report and finalize**
   - When `next` returns `complete`, write the local report:

     ```bash
     npm run wearit:batch -- report --workspace <workspace>
     ```

   - Confirm the report includes `review.html`, accepted/quarantined counts,
     attempt history, reasons, and the deterministic 10% accepted-item audit
     sample.
   - Finalize accepted items only:

     ```bash
     npm run wearit:batch -- finalize \
       --workspace <workspace> \
       --repo /home/adam/Dev/Lab/Wearit \
       --bundle /home/adam/Dev/Lab/Wearit/data/import-bundles/<batch>
     ```

   - If report generation or bundle validation fails, treat it as
     infrastructure failure: stop the batch and move no sources.
   - Report the exact package and `review.html` paths, accepted and quarantined
     counts, and the 10% audit sample. End with:
     **“Package prepared locally; nothing was uploaded.”**

## Conservative rules

- No human per-item pause in autonomous mode.
- No older output reuse; every generated asset is versioned and immutable.
- Maximum three candidate generation cycles per item.
- Preserve an accepted product image on wear-only retry.
- A local fit defect requires targeted regeneration, never scaling alone.
- One failed, uncertain, or below-threshold region vetoes acceptance.
- Item-quality failures retry or quarantine and never stop sibling items.
- Only infrastructure failures stop the batch.
- Quarantined and unbundled sources remain untouched.
- Nothing uploads.

