# Personal Wardrobe V1 Design

**Date:** 2026-07-17

**Status:** Approved product design, awaiting specification review

## Summary

Adapt the upstream Wardrobe project into a private, phone-first wardrobe for one primary user. She photographs one garment at a time, a local Codex-assisted workflow prepares transparent cutouts, and the deployed application lets her combine those garments on a neutral faceless mannequin. She can save outfit combinations and record when either an outfit or an individual garment was worn.

V1 deliberately avoids generating images of her face or body. The dressing room is an instant 2D composition of approved garment cutouts on a synthetic mannequin. A later version may offer optional realistic AI rendering on a fully synthetic mannequin, but that is not part of this release.

## Product goals

- Make the initial import of the whole wardrobe practical for the couple to complete together.
- Make choosing and switching garments fast on both phone and desktop.
- Save named outfit combinations containing at least two garments.
- Record reliable wear history without rewriting the past when an outfit changes.
- Keep wardrobe photos and data private by default.
- Leave the data model safe for more than one account, even though V1 is a private single-user experience.

## Non-goals for V1

- Using the owner's face, body, or likeness in generated images.
- Realistic generative try-on or fit prediction.
- Importing arbitrary photos from the phone gallery automatically.
- Self-service in-app garment extraction and AI processing.
- Social features, public profiles, sharing, recommendations, or public signup.
- Full offline editing and later conflict resolution.
- Native iOS or Android applications.

## Users and access

V1 has one primary wardrobe owner. The application uses Supabase Auth with passwordless email login. Accounts are invitation-only: public signup is disabled, and the owner is invited through an administrative path.

Every persisted row has an `owner_id` tied to `auth.uid()`. Row Level Security (RLS) restricts users to their own records, and Storage policies use the same owner boundary. This makes a second private account possible later without redesigning the schema or exposing the first wardrobe.

## System architecture

### Deployed application

- The existing React and Vite application is adapted into a responsive installable web app.
- Vercel hosts the static application and any small server-only operations that require secrets.
- Supabase provides Auth, Postgres, and private Storage.
- The browser uses the Supabase anonymous key and the signed-in user's session. It never receives a service-role key.
- Server-only secrets remain in Vercel environment variables. Local import credentials remain in ignored local environment files and are never committed.
- V1 uses no OpenAI API calls in the deployed application.

### Local import workflow

Codex runs the initial import locally from purpose-shot garment photos. Raw source photos remain on the local machine. Only reviewed transparent cutouts, optional detail images, thumbnails, and their metadata are uploaded.

The importer must use an authenticated owner-scoped upload path or a protected server-side import operation. It must not embed or expose a Supabase service-role key in browser code or generated assets.

### Privacy boundary

- Raw source photos always remain local in V1. Only reviewed derivative assets are uploadable.
- Uploaded buckets are private.
- Stored paths begin with the authenticated owner's ID.
- Access uses authenticated requests or short-lived signed URLs.
- Logs must not contain image bytes, login links, access tokens, or service credentials.

## Upstream adaptation

The upstream project is a local-first gallery whose web importer depends on an OpenAI API key and a personal model-reference image. V1 keeps useful gallery, review, editing, and visual styling patterns, while replacing these assumptions:

- Replace `data/library.json` and local-file middleware with a Supabase-backed repository layer.
- Remove the personal model-reference requirement from the V1 user flow.
- Do not generate a second modeled image for each garment; the approved cutout is the dressing-room asset.
- Adapt the bundled local import workflow to produce faceless-mannequin metadata and cutouts without requiring the wife's likeness.
- Do not deploy the upstream unauthenticated local import endpoints.

## Data model

All primary keys are UUIDs. Timestamps are stored in UTC and displayed in the user's local timezone.

Relationships that repeat `owner_id` use composite foreign keys or equivalent database constraints. An association cannot point to another owner's garment, outfit, or wear event even if application code is faulty.

### `profiles`

- `id`: references the Supabase Auth user and is also the ownership identity.
- `display_name`
- `created_at`, `updated_at`

### `wardrobe_items`

- `id`, `owner_id`
- `name`, `category`, `slot`, `brand`, `size`, `notes`
- `colors` and `tags`
- `cutout_path` and optional `detail_image_paths`
- Mannequin placement: `anchor_x`, `anchor_y`, `scale`, `rotation_degrees`, and `layer_order`
- `status`: `active` or `archived`
- `created_at`, `updated_at`, `archived_at`

`last_worn_at` is not stored here. It is derived from wear events so it cannot drift away from history.

### `outfits`

- `id`, `owner_id`
- `name`
- `thumbnail_path`
- `needs_attention`
- `created_at`, `updated_at`

### `outfit_items`

- `outfit_id`, `wardrobe_item_id`, `owner_id`
- `slot` and `layer_order`
- A unique constraint prevents the same garment appearing twice in one outfit.

An outfit must contain at least two distinct active garments when saved. Saving and updating happens through one transaction that validates ownership, active status, slot compatibility, and the minimum count. Direct client writes must not be able to bypass this validation.

### `wear_events`

- `id`, `owner_id`
- `worn_at`
- Optional `outfit_id` as context only
- Optional `notes`
- `created_at`

### `wear_event_items`

- `wear_event_id`, `wardrobe_item_id`, `owner_id`
- A unique constraint prevents duplicate items in one wear event.

These rows are the immutable snapshot of exactly which garment IDs were worn. Editing a saved outfit later does not alter previous wear events. Wardrobe items referenced by history are archived rather than deleted, so the reference remains meaningful.

## Storage layout

Use private buckets with owner-prefixed paths, for example:

```text
wardrobe-assets/{owner_id}/items/{item_id}/cutout.webp
wardrobe-assets/{owner_id}/items/{item_id}/details/{asset_id}.webp
wardrobe-assets/{owner_id}/outfits/{outfit_id}/thumbnail.webp
```

Storage RLS verifies that the first path segment matches `auth.uid()`. Database records remain the source of truth; orphaned uploads are cleaned up by a reconciliation operation, not silently ignored.

## Mannequin and outfit rules

V1 uses one canonical neutral mannequin and a fixed coordinate system. Each garment stores reusable placement metadata against that coordinate system. Compositing is deterministic and instant; it does not call an image model.

Supported slots are `top`, `bottom`, `dress`, `outerwear`, `shoes`, and `accessory`. V1 supports one selected garment per slot, with these rules:

- Selecting another garment in the same slot replaces the current garment.
- Outerwear renders above a top or dress.
- Selecting a dress clears the current top and bottom.
- Selecting a top or bottom clears the current dress.
- Shoes and an accessory can coexist with the clothing slots.
- Undo restores the previous composition state; Clear removes all selected garments.
- Save is enabled only when two or more compatible garments are selected.

The initial alignment values are produced during import and can be corrected in an admin-only alignment screen. The regular dressing room does not expose technical transform controls.

## Core user flows

### Browse and dress

The user opens Wardrobe, filters or browses active garments, and taps one to add it to the mannequin. Tapping another item in the same slot replaces it immediately. The current selection remains visible while browsing other categories.

On phone, the mannequin gets most of the screen, with a swipeable garment tray and bottom navigation for Wardrobe, Dress, Outfits, and History. On desktop, the garment library, mannequin, and current outfit are visible side by side. Both layouts expose the same actions and data.

### Save and edit an outfit

With at least two items selected, the user gives the outfit a name and saves it with a generated thumbnail. From a saved outfit she can:

- load it into the mannequin;
- change garments and update the existing outfit;
- save the changed selection as a new variation;
- rename it or regenerate its thumbnail.

Exact duplicate combinations are surfaced before saving. The user may still create meaningful variations that differ by at least one garment.

### Record a wear

From the current mannequin or a saved outfit, **Wear outfit** creates one wear event plus one immutable item row for every selected garment in a single transaction. A garment detail view also supports **Mark worn** for recording one item independently. The date defaults to now but can be changed for backfilling the wardrobe's history.

The History view is derived from these events. Each garment's last-worn value is the latest event containing that garment.

### Archive a garment

Archiving removes a garment from normal browse and new outfit selection without deleting its assets or history. Saved outfits containing it are marked `needs_attention` and identify the missing slot. Their historical wear events remain unchanged.

## Initial import workflow

1. Run a pilot with about ten representative garments across different categories and shapes.
2. Photograph one garment per image against a simple, consistent background with clear lighting. One front image is the default; back or detail images are optional.
3. Place the dedicated photos in a local import folder.
4. Codex inventories the folder, detects likely duplicates, and creates resumable import jobs with stable IDs.
5. For each garment, produce a transparent cutout plus proposed category, colors, tags, and mannequin placement.
6. Keep uncertain results as local drafts for human review instead of guessing or uploading them.
7. Review cutout quality and alignment in the admin screen, correcting scale and anchor where needed.
8. Upload only approved assets and metadata, then reconcile Storage and database state.
9. After the pilot is accepted, process the remaining wardrobe in manageable batches.

The pipeline is idempotent: rerunning a completed item does not create duplicate garments or assets. A failed upload can resume from the last verified step.

## Reliability and error behavior

- Multi-row operations such as save outfit and record wear are transactional.
- Optimistic UI updates roll back visibly if persistence fails and preserve the user's current selection for retry.
- Upload failures report which item failed and can resume without repeating successful items.
- Database and Storage reconciliation identifies partial uploads and missing assets.
- V1 requires connectivity for writes. The application may cache its shell and recently viewed images, but it does not queue offline mutations.
- Auth expiry returns the user to login without discarding an unsaved in-memory outfit during the current tab session when practical.

## Testing strategy

### Unit tests

- Slot replacement and dress/top/bottom exclusion rules.
- Render ordering and undo/clear state.
- Outfit minimum-item and compatibility validation.
- Duplicate-combination detection.
- Derived last-worn calculations.

### Database tests

- RLS isolation between two test users for every table and Storage path.
- Atomic outfit saving and wear recording.
- Rejection of cross-owner or archived garment references.
- Archive behavior, `needs_attention`, and retained history.

### End-to-end tests

- Invitation login and logout.
- Browse, dress, replace, clear, and undo.
- Save, load, edit, update, and save-as-new outfit flows.
- Record outfit and individual wear events and verify history.
- Verify the same persisted state on phone and desktop viewports.

### Visual and manual checks

- Responsive and visual-regression coverage for the phone and desktop layouts.
- Keyboard navigation, touch targets, focus visibility, labels, contrast, and reduced-motion behavior.
- Manual inspection of every pilot cutout and mannequin alignment before bulk import.

## Delivery sequence

1. Establish Supabase schema, private Storage, Auth, RLS, and a repository boundary in the app.
2. Prove the ten-garment local import and admin alignment workflow.
3. Build the responsive wardrobe and deterministic mannequin composer.
4. Add transactional saved outfits, thumbnails, wear events, history, and archive behavior.
5. Add automated coverage, deploy to Vercel, and complete phone/desktop privacy and usability checks.
6. Import the remaining wardrobe in reviewed batches.

## V1 acceptance criteria

- The invited owner can sign in privately on phone and desktop.
- At least ten pilot garments can be imported without uploading raw source photos.
- Garments switch instantly on a faceless mannequin according to the documented slot rules.
- An outfit with two or more garments can be saved, loaded, edited, updated, or saved as a variation.
- Wearing an outfit records every included garment, and later outfit edits do not change that history.
- An individual garment can be marked worn for a chosen date.
- Last-worn values are derived correctly from wear events.
- Archiving a garment preserves history and flags affected saved outfits.
- A second test account cannot read or modify the owner's database rows or Storage assets.
- The core flows are usable at representative phone and desktop widths.
- No deployed V1 path requires the wife's face/body image or an OpenAI API key.

## Risks and mitigations

- **Cutouts may look unnatural on the mannequin.** Use a consistent photography setup, pilot varied garments, and provide admin alignment controls before bulk import.
- **Layering cannot perfectly represent physical drape.** Keep V1 to deterministic outfit visualization, not fit simulation, and set expectations accordingly.
- **Bulk import may become tiring.** Work in batches, preserve progress with stable IDs, and review only uncertain or failed items.
- **Private imagery could leak through configuration mistakes.** Use private buckets, owner-prefix policies, two-user RLS tests, secret scanning, and no service credentials in the browser.
- **Upstream local endpoints are unsafe to publish unchanged.** Replace them with authenticated owner-scoped persistence before deploying.
- **Offline edits could conflict.** Require connectivity for V1 writes and defer offline mutation queues until a conflict model is designed.

## Deferred possibilities

After V1 has real usage evidence, possible follow-ups include self-service camera import, more garment layers or accessories, smarter outfit suggestions, calendar or weather context, sharing, and optional realistic rendering on a synthetic mannequin. Each is a separate product decision rather than an implicit part of this design.

There are no unresolved product decisions required to begin implementation planning for V1.
