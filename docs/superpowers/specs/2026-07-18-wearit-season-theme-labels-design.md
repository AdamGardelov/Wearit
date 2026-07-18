# Wearit Season and Theme Labels Design

Date: 2026-07-18  
Status: Approved in conversation

## Context

Wearit currently organizes active clothes by garment category and stores free-form descriptive tags, but tags are not filterable and saved outfits have no equivalent metadata. The wardrobe owner changes which clothes she uses by season and also wants situational groupings such as Rainy day, Birthday, and Costume.

The feature must keep All as the default view, work on phone and desktop, apply to individual clothes and saved outfits, and preserve the existing category, archive, outfit, and history behavior.

## Goals

- Let each clothing item belong to zero or more fixed seasons and zero or more owner-created themes.
- Let each saved outfit use the same labels.
- Filter Wardrobe, Dress, and Outfits without hiding anything by default.
- Suggest useful labels when saving a new outfit while keeping the owner in control.
- Keep labels private and owner-scoped through Supabase.
- Preserve existing unlabeled clothes and outfits.

## Non-goals

- Weather APIs, forecasts, or automatic Rainy day selection.
- AI classification of clothes or outfits.
- Labels on individual wear-history entries.
- Replacing existing descriptive tags.
- Changing the reviewed import-bundle format in this first slice.
- Persisting active filters across a full page reload.

## Terminology

A label has one of two kinds:

- `season`: one of the fixed keys `spring`, `summer`, `autumn`, or `winter`.
- `theme`: an owner-created name such as Rainy day, Birthday, or Costume.

The fixed season keys are stored independently of their display text so the UI can render localized names such as Vår, Sommar, Höst, and Vinter. Existing free-form item tags remain descriptive metadata and do not participate in this filter system.

## User-facing behavior

### Default and filter matching

With no selected labels, every active item or saved outfit is visible. This is the All state and is restored on a fresh page load.

Filter matching follows these rules:

- Multiple selected seasons use OR within the season group.
- Multiple selected themes use OR within the theme group.
- When both groups have selections, an entry must match at least one selected season AND at least one selected theme.
- The existing garment category filter combines with label filters using AND.
- Unlabeled entries appear under All and disappear only when a label filter is active.

Examples:

- Summer + Winter shows entries assigned to either season.
- Summer + Rainy day shows entries assigned to Summer and Rainy day.
- Summer + Rainy day + Shoes shows shoes that match both label groups.

### Shared filter context

Wardrobe, Dress, and Outfits share one active label-filter state while the app remains open. Moving from Wardrobe to Dress therefore keeps Summer selected. A browser reload resets the shared state to All.

Each applicable view provides the same responsive filter control:

- A compact Filter trigger.
- Separate Season and Theme groups.
- Multi-select controls with clear selected states.
- Selected labels rendered as removable chips.
- A Clear all action.
- When filtered, counts show the visible count relative to the total.

On phones the control opens as a bottom sheet or full-width panel. On desktop it uses the same component in a suitably sized popover or panel. Exact visual placement follows the existing Wearit navigation and spacing system.

### Wardrobe

The existing garment-category row remains. The label filter sits alongside it without turning seasons or themes into garment categories. The gallery applies category and label predicates together.

### Item settings

Every item editor contains:

- A Seasons section with multi-select Spring, Summer, Autumn, and Winter controls.
- A Themes section with owner-created multi-select controls.
- An inline Create theme action.
- Theme management actions for rename and delete.

An item may have multiple seasons and themes. Saving an item replaces its complete label assignment with the current selection. Empty selections are valid.

### Dress

The shared label filter narrows the garment tray in addition to the tray's garment-category selection. Changing filters never removes clothes already placed on the mannequin. This prevents a filtering action from destroying the current composition.

### Outfits

Saved outfits are filtered by their own saved labels, not by recalculating labels from their clothes at read time. This preserves manual intent.

When creating a new outfit, Wearit suggests the intersection of the selected clothes' labels: a label is preselected only when every clothing item has it. The owner may add or remove any suggested label before saving.

When updating an existing outfit, Wearit retains that outfit's current labels rather than silently replacing them with new suggestions. Saving as a new variation uses fresh suggestions from the current composition and remains editable.

Existing outfits start with no labels and remain visible under All.

## Data model

Add a forward-only Supabase migration. Do not edit applied migrations.

### `wardrobe_labels`

Owner-scoped label records contain:

- `id uuid` primary key.
- `owner_id uuid` referencing `profiles`, with cascade delete.
- `kind text` constrained to `season` or `theme`.
- `season_key text null`, required only for seasons and constrained to the four fixed keys; themes must store null.
- `name text not null`, trimmed and length-limited. Seasons store the canonical English names Spring, Summer, Autumn, and Winter; the UI localizes them from `season_key`.
- `normalized_name text`, generated as lowercase trimmed `name` and used for theme uniqueness.
- `locked boolean`, constrained to true for seasons and false for themes.
- Created and updated timestamps.
- Unique `(owner_id, id)` for owner-scoped foreign keys.
- Unique `(owner_id, season_key)` for season rows.
- A partial unique index on `(owner_id, normalized_name)` where `kind = 'theme'`.

The migration seeds four locked season rows for every existing profile. The forward migration also replaces `create_profile_for_user()` so future profiles receive their four season rows in the same trigger transaction.

Locked seasons cannot be renamed or deleted through public operations. Themes can be created, renamed, and deleted only by their owner. Theme names are trimmed, length-limited, and unique case-insensitively per owner.

### `wardrobe_item_labels`

- `owner_id uuid`.
- `wardrobe_item_id uuid`.
- `label_id uuid`.
- Primary key `(wardrobe_item_id, label_id)`.
- Composite owner-scoped foreign keys to `wardrobe_items` and `wardrobe_labels`.
- Cascade delete from the item or label.

### `outfit_labels`

- `owner_id uuid`.
- `outfit_id uuid`.
- `label_id uuid`.
- Primary key `(outfit_id, label_id)`.
- Composite owner-scoped foreign keys to `outfits` and `wardrobe_labels`.
- Cascade delete from the outfit or label.

All three tables enable RLS. Authenticated users can read only their own rows. Mutations go through owner-checking database operations; anonymous access is denied.

## Repository and state boundaries

The repository exposes focused operations rather than leaking table details into components:

- List all labels for the authenticated owner.
- Create, rename, and delete an owner theme.
- Replace an item's complete label assignment.
- Load item labels with wardrobe items.
- Load outfit labels with outfits.
- Save an outfit's complete label assignment.

Theme deletion is confirmed in the UI and cascades only through assignment rows. It never deletes clothes, outfits, thumbnails, or history.

At the application boundary, maintain one shared label-filter state:

```text
selectedSeasonIds: []
selectedThemeIds: []
```

Filtering uses small pure functions shared by Wardrobe, the Dress garment tray, and Outfits. The current personal wardrobe is small enough that filtering loaded owner data in the browser is simpler and faster than issuing a database query for every filter change.

Label assignment uses stable UUIDs. Display names are never identifiers, so renaming a theme updates every assigned item and outfit automatically.

## Validation and error handling

- Creating a blank or duplicate theme is rejected with an inline message.
- Renaming to an existing theme name is rejected case-insensitively.
- Deleting a theme requires confirmation and states that clothes and outfits will remain.
- If a selected theme is deleted, remove its ID from the active filter state.
- If label loading fails, preserve the normal view shell and show an error instead of presenting an incorrect empty wardrobe.
- Assignment operations validate that the owner owns the target item or outfit and every submitted label.
- Fixed seasons remain usable even when no custom themes exist.
- Archived items remain governed by existing archive behavior; label deletion never restores or archives an item.
- Outfit history and wear events remain valid when labels change or disappear.

## Compatibility and migration

- Existing clothes and outfits receive no assignments and therefore remain visible under All.
- Existing item `tags` remain unchanged.
- Existing category filters, mannequin composition, outfit thumbnails, wear history, and archive semantics remain valid.
- Existing import bundles continue to work without label fields. Labels are added afterward in item settings.
- The feature adds no AI SDK, API route, OpenAI key, weather service, or deployment secret.

## Verification strategy

This private project uses feature-first development rather than strict TDD. Add high-value regression coverage after the vertical slice works.

Database checks:

- RLS prevents cross-owner label and assignment access.
- Fixed seasons exist for existing and newly created profiles.
- Locked seasons cannot be renamed or deleted.
- Theme names are unique case-insensitively per owner.
- Assignment operations reject foreign items, outfits, and labels.
- Deleting a theme removes assignments but preserves clothes, outfits, and history.

Application checks:

- All is the initial state.
- OR within a label group and AND across groups work correctly.
- Category filters compose with label filters.
- Shared filters affect Wardrobe, Dress, and Outfits while the app is open.
- Reload returns to All.
- Changing Dress filters does not remove the current mannequin composition.
- Item settings save multiple seasons and themes.
- New-outfit suggestions use the intersection of all selected clothes.
- Updating an existing outfit preserves manually selected labels.
- Saving a variation uses fresh editable suggestions.
- Existing unlabeled entries remain visible under All.
- Theme create, rename, delete, duplicate-name, and confirmation flows work on phone and desktop.

Run the existing app tests, database tests, and production build. Manually verify the responsive filter panel and multi-select controls on a real phone and desktop browser.
