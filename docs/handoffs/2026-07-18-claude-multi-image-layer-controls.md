# Claude Handover: Multi-Image Items and Outfit Layer Controls

## Objective

Implement the approved design in `docs/superpowers/specs/2026-07-18-wearit-multi-image-layer-controls-design.md`.

Claude owns application code, migrations, targeted tests, and manual verification. Codex owns the real pilot image generation and v2 bundle after the application accepts the new format.

## Working style requested by Adam

This is a private project for Adam's wife. Optimize for quick delivery and a usable vertical slice.

- Strict TDD is not required.
- Implement first, check the feature manually, then add only high-value regression coverage.
- Do not spend days automating every gesture or rare edge case.
- Fix non-critical bugs as they are found.
- Keep ownership/privacy and data-persistence safeguards because they protect personal data.

## Repository

- Path: `/home/adam/Dev/Lab/Wearit`
- Branch at handover: `codex/wearit-v1`
- Remote: `git@github.com:AdamGardelov/Wearit.git`
- Frontend: React/Vite
- Backend: Supabase
- Intended hosting: Vercel

Open Claude from `/home/adam/Dev/Lab/Wearit`, not the stale `/home/adam/Dev/Lab/Wardrobe` workspace path.

## Preserve local work

Inspect `git status` before editing. At design time the branch was one commit ahead of its remote with uncommitted photoreal mannequin work in:

- `public/mannequin-photoreal.png`
- `src/features/dress/MannequinCanvas.jsx`
- `src/features/outfits/SaveOutfitDialog.jsx`
- `src/features/outfits/OutfitsView.test.jsx`

Do not revert or overwrite these changes. Keep unrelated changes out of feature commits where practical.

## Approved behavior

- New items have a required front product image plus optional back/details.
- Product photos are separate from the transparent mannequin layer.
- Wardrobe cards use the primary product image; legacy items fall back to cutouts.
- Item panel includes ordered/labeled thumbnails.
- Large image opens a full-screen ecommerce-style zoom viewer.
- Phone: swipe, pinch, double-tap, pan, and unzoomed swipe-down close.
- Desktop: click, zoom controls, pan, arrows, and keyboard close/navigation.
- Display names may duplicate; hidden UUIDs identify physical items.
- Dress screen has general move-forward/move-backward layer controls.
- Layer order belongs to the current composition and is saved per outfit.
- Replacing a garment in the same slot preserves its stack position.
- Re-importing the same UUID updates and restores it.
- No runtime AI and no wife-facing upload flow.

## Existing implementation anchors

- Foundation schema: `supabase/migrations/202607170001_wardrobe_foundation.sql`
- Outfit schema/RPCs: `supabase/migrations/202607170002_outfits_and_wear.sql`
- Import RPC: `supabase/migrations/202607170003_import_wardrobe_item.sql`
- Repository: `src/data/wardrobeRepository.js`
- Bundle preparation: `scripts/prepare-import-bundle.mjs`
- Browser bundle parser: `src/features/admin/importBundle.js`
- Owner import review: `src/features/admin/ImportAdminView.jsx`
- Wardrobe gallery: `src/features/wardrobe/WardrobeView.jsx`
- Item panel: `src/features/wardrobe/ItemEditorDialog.jsx`
- Composition reducer: `src/domain/mannequin.js`
- Dress UI: `src/features/dress/DressingRoom.jsx`
- Mannequin: `src/features/dress/MannequinCanvas.jsx`
- Thumbnail rendering: `src/features/outfits/renderOutfitThumbnail.js`
- Outfit row mapping: `orderedOutfitItems` in `src/data/wardrobeRepository.js`

Current behavior to account for:

- `cutout_path` is the mannequin composition layer.
- `detail_image_paths` exists but `listItems` does not sign or expose it.
- Current bundle preparation derives item UUIDs from cutout bytes.
- `outfit_items.layer_order` exists, but `save_outfit` copies the base item value.
- Outfit reads expose `saved_layer_order`, while rendering still uses base `layer_order`.
- `MannequinCanvas` uses `layer_order` as CSS `z-index`.

## Compatibility boundary

- Add forward-only migrations; do not edit applied migration files.
- Version 1 bundles continue to work.
- Existing items without product-image rows remain visible.
- Existing outfits and wear history remain valid.
- Existing private storage and owner RLS remain protected.
- Do not add an AI SDK, API route, key, or Vercel secret.

## Real pilot assets are Codex's job

Do not modify, import, or commit the real source photos. Codex will later process:

- `IMG_7346_front.jpg` + `IMG_7347_back.jpg`: one Disco T-shirt
- `IMG_7349.jpg`: green striped shirt
- `IMG_7350.jpg`: navy cap
- `IMG_7351.jpg`: grey-green cap
- `jeansshorts.jpg`: denim shorts
- `kjol.jpg`: green skirt

Sources remain at `/home/adam/Pictures/wearit-pilot` outside git. Claude may create tiny generated fixtures for automated tests only.

## Suggested delivery order

This is guidance, not a TDD gate:

1. Add structured image schema and v2 RPC.
2. Teach bundle preparation/parser/repository to import and sign v2 images.
3. Show primary product photos and front/back thumbnails.
4. Add the full-screen viewer and manually validate it.
5. Add composition layer moves and the Layers UI.
6. Persist layer order through outfit save/load and thumbnail rendering.
7. Add a small set of regression tests around data ownership and save/load.
8. Run final smoke verification.

## Verification

At minimum, manually prove:

- Two different UUIDs can use the same name.
- A front/back fixture switches and zooms.
- A legacy item still displays.
- Move forward/backward changes the mannequin immediately.
- Replacing a slot preserves its rank.
- Two saved outfits retain different stacking for the same top/bottom.
- Re-import restores an archived v2 item.

Run these when the environment permits:

```bash
npm test
npm run test:db
npm run build
```

Report environmental failures separately from code failures. Manual phone behavior is authoritative for touch gestures.

## Known adjacent issues

Do not claim these are fixed unless explicitly addressed and checked:

1. Import completion does not immediately refresh `WardrobeView` local state until reload.
2. The current import upsert leaves archived items archived; v2 must restore explicitly.
3. Existing content-derived IDs can collide for deliberately identical physical items; v2 explicit UUIDs solve new imports.
4. Saved-outfit permanent deletion was separately requested and approved but is outside this design. Required semantics: confirmation, delete only outfit/thumbnail, preserve clothes and wear history, null referencing `wear_events.outfit_id`, and keep Delete available for unavailable outfits.

## Handoff back to Adam and Codex

When the vertical slice works, provide:

- Concise schema, importer, gallery, viewer, and layer-state summary.
- New migration names and compatibility notes.
- Commands run and their results.
- Touch interactions Adam still needs to confirm.
- Exact final v2 manifest contract Codex should use.
- No real image generation or pilot import; Codex performs that next.
