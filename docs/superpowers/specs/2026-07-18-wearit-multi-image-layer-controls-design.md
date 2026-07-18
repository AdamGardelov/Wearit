# Wearit Multi-Image Items and Outfit Layer Controls Design

Status: approved by Adam on 2026-07-18.

## Summary

Wearit will support optional front/back/detail product photos, ecommerce-style image viewing and zoom, duplicate display names backed by hidden unique UUIDs, and user-controlled garment stacking on the mannequin. Product photos and mannequin layers remain separate assets: product photos are for browsing, while one transparent mannequin-fitted front layer per item is used for deterministic outfit composition.

Claude implements the application and import-format changes. Codex prepares the real pilot images and import bundle afterward. The deployed app performs no AI work and exposes no wife-facing clothing upload.

## Goals

- One required front product image plus optional back/detail images per new item.
- Product images in the wardrobe gallery; mannequin layers only in Dress.
- Full-screen zoom and image navigation on phone and desktop.
- Duplicate editable display names with independent hidden UUIDs.
- General move-forward/move-backward mannequin layer controls.
- Exact per-outfit layer order preserved across save/load.
- Compatibility with existing items, outfits, and wear history.

## Non-goals

- No runtime AI, virtual try-on, face, or body generation.
- No wife-facing clothing upload or image processing.
- No back-view mannequin in this iteration.
- No runtime tucked/untucked inference.
- No exhaustive automated gesture suite or strict TDD workflow.

## Approved decisions

1. Front is the primary product image; back and details are optional.
2. Back/detail images are browsable but never separate dressable items.
3. Visible names do not need to be unique and are never used as IDs.
4. Every physical item has a hidden UUID generated once during local preparation.
5. Layer controls are general `Move forward` and `Move backward` actions.
6. Layer changes affect the current composition, not the garment default.
7. Saved outfits snapshot the customized order.
8. Replacing an item in the same slot preserves that slot's stack position.

## Item identity

`wardrobe_items.id` remains the canonical UUID. Version 2 import drafts receive a random UUID once when Codex creates the reviewed source manifest. Bundle preparation validates and preserves it instead of deriving identity from mannequin-layer bytes.

This allows several physical items to share a display name such as `Jeans shorts`, and also allows two visually identical physical items to coexist. Re-running the same manifest UUID updates that item. Using another UUID creates a separate item. UUIDs and storage paths stay out of the normal UI.

## Structured product images

Add `public.wardrobe_item_images`:

- `id uuid primary key`
- `owner_id uuid not null`
- `wardrobe_item_id uuid not null`
- `storage_path text not null`
- `view text not null` constrained to `front`, `back`, or `detail`
- `sort_order integer not null`
- `is_primary boolean not null default false`
- timestamps

Integrity requirements:

- Composite owner/item foreign key with cascade on item deletion.
- Unique storage path and sort order within an item.
- Exactly one primary image for every v2 item; it must be the front image.
- At most one front and one back; multiple details are allowed.
- Owner-only RLS reads. Import RPCs own mutations.
- No `PUBLIC` or anonymous mutation access.

Keep `wardrobe_items.cutout_path` as the mannequin-layer path. Keep `detail_image_paths` temporarily for v1 compatibility. Existing items without structured product images use their current cutout as the wardrobe-image fallback.

## Private storage

Use immutable versioned paths in the existing private `wardrobe-assets` bucket:

```text
{owner_id}/items/{item_id}/wear-layer/{version}.png
{owner_id}/items/{item_id}/images/{image_id}-{version}.{ext}
```

New database state commits before obsolete objects are removed. A cleanup failure becomes a warning; it must not make a committed import appear unsuccessful.

## Import bundle v2

Keep reading version 1 bundles. Version 2 separates the layer from product images:

```json
{
  "version": 2,
  "items": [{
    "id": "item-uuid",
    "name": "Black Disco Soho T-shirt",
    "category": "top",
    "slot": "top",
    "wearLayerFile": "assets/<item-id>/wear-layer.png",
    "images": [
      {
        "id": "front-image-uuid",
        "file": "assets/<item-id>/images/front.webp",
        "view": "front",
        "sortOrder": 0,
        "isPrimary": true
      },
      {
        "id": "back-image-uuid",
        "file": "assets/<item-id>/images/back.webp",
        "view": "back",
        "sortOrder": 1,
        "isPrimary": false
      }
    ],
    "colors": ["#202020", "#e95a9f"],
    "tags": ["t-shirt", "disco"],
    "placement": {
      "anchorX": 0.5,
      "anchorY": 0.34,
      "scale": 0.62,
      "rotationDegrees": 0,
      "layerOrder": 30
    },
    "status": "accepted"
  }]
}
```

Validate UUID uniqueness, contained regular files, one primary front, supported image formats, transparent RGBA mannequin layer, and existing category/placement rules. Display names are required but never unique.

The v2 import uploads versioned objects and calls an owner-scoped security-definer RPC that atomically upserts the item and replaces its image rows. Explicit re-import of an archived UUID sets it active, clears `archived_at`, and recomputes `needs_attention` for referencing outfits. Pre-commit upload failures are cleaned up when possible; post-commit cleanup failures return warnings.

## Repository item shape

`listItems` signs mannequin and structured product paths in batches and returns:

```js
{
  id,
  name,
  cutoutUrl,
  primaryImageUrl,
  images: [{ id, view, sortOrder, isPrimary, url }]
}
```

Images are ordered by `sortOrder`, then stable ID. `primaryImageUrl` falls back to `cutoutUrl` for legacy items.

## Wardrobe gallery and zoom

The wardrobe grid displays `primaryImageUrl`. Tapping an item opens the existing item editor with an image gallery above its metadata:

- Large active image.
- Front/back/detail thumbnails when multiple images exist.
- Labels and position such as `1 / 2`.
- Swipe navigation on phone and left/right keyboard navigation.

Tapping the large image opens a full-screen lightbox:

- Phone: pinch, double-tap, pan, image swipe, and swipe-down close while unzoomed.
- Desktop: click, `+`, `-`, reset, pan, arrows, and `Escape`.
- `X` close control on all devices.
- Zoom/pan reset when switching images.
- Focus remains trapped in the topmost modal and returns to the image trigger.
- Failed images show a retry without blocking other photos.

Grid/panel views use responsive derivatives; full-resolution signed assets are requested only for the lightbox.

## Mannequin layer controls

Composition state owns an effective layer order. Moving an item must not update the repository item or its default `layer_order`.

Add a reducer action equivalent to:

```js
{ type: "move-layer", itemId, direction: "forward" | "backward" }
```

- Forward/backward swaps one adjacent selected item.
- Normalize layer ranks to unique deterministic integers.
- Replacing an occupied slot inherits the outgoing entry's rank.
- Selecting into an empty slot starts near the item's default and resolves collisions deterministically.
- A move is undoable.
- Rendering and outfit thumbnails use the effective value.

The Dress screen's selected-piece summary becomes a `Layers` list, frontmost first. Each row has item-specific `Move forward` and `Move backward` buttons. Boundary buttons are disabled. Touch targets remain at least 44 pixels high. Drag-and-drop is not required.

## Saving and loading layer order

`outfit_items.layer_order` already holds a snapshot and remains the saved source of truth. Extend the outfit-save RPC to accept one integer layer value per selected item instead of copying the item's default.

Validate equal item/layer cardinality, unique owned active items, valid slots, in-range integer layers, and unique layer values. Keep a compatibility path for the existing save signature if needed. New saves always send composition values.

When reading an outfit, use `outfit_items.layer_order` as the effective `layer_order`; do not leave the wardrobe item's default in control. Loading and thumbnail rendering must reproduce the saved stack exactly. Wear history continues recording item IDs and does not need layer values.

## Privacy and safety worth retaining

This is a private low-risk app, so implementation should be fast and feature-first. Still retain safeguards that protect personal wardrobe data:

- Private bucket and short-lived signed URLs.
- Owner RLS and `auth.uid()` ownership.
- Security-definer functions with explicit schemas, empty `search_path`, and restricted grants.
- Forward-only migrations; do not edit applied migrations.
- Original photos stay outside git and are never deployed.
- No AI keys or AI calls in the application.

## Fast verification strategy

Strict TDD is not required. Claude may implement the working vertical path first, verify it manually, then add only high-value regression tests.

Minimum useful checks:

- Database: ownership, one-primary-front integrity, re-import restoration, and saved layer values.
- Import: front-only, front/back, duplicate names with different UUIDs, and v1 compatibility.
- Domain: adjacent layer move, replacement rank, undo, and saved-order load.
- UI: primary gallery image, front/back selection, basic lightbox keyboard close/navigation, and layer buttons.
- Final smoke: `npm test`, `npm run test:db`, and `npm run build` when the environment permits.
- Manual phone/desktop checking is authoritative for pinch, swipe, visual quality, and touch comfort.

Do not delay a usable private release for exhaustive edge-case or gesture automation. Fix bugs as they are found.

## Pilot batch handled by Codex

| Item | Source files | Product images | Mannequin layer |
| --- | --- | --- | --- |
| Black Disco Soho T-shirt | `IMG_7346_front.jpg`, `IMG_7347_back.jpg` | Front and back | Front |
| Green striped shirt | `IMG_7349.jpg` | Front | Front |
| Navy cap | `IMG_7350.jpg` | Front | Front |
| Grey-green cap | `IMG_7351.jpg` | Front | Front |
| Denim shorts | `jeansshorts.jpg` | Front | Front |
| Green skirt | `kjol.jpg` | Front | Front |

Codex will preserve logos, prints, colors, garment construction, and front/back differences while producing realistic ecommerce derivatives and separate transparent mannequin-fitted layers. Originals stay in `/home/adam/Pictures/wearit-pilot`.

## Acceptance criteria

1. Duplicate display names coexist and remain independently editable.
2. Front/back images appear in the correct labeled order.
3. Legacy and single-photo items still browse correctly.
4. Zoom/navigation feels natural on phone and works by mouse/keyboard on desktop.
5. Layer controls update the mannequin immediately without changing defaults.
6. Same-slot replacement preserves composition position.
7. Two saved outfits using the same garments can retain different layer orders.
8. Loading an outfit reproduces its order in both mannequin and thumbnail.
9. Re-importing the same UUID updates/restores it; a new UUID creates a separate item.
10. The deployed app uses no AI and contains no source photos or secrets.
