# Wearit Custom Item Categories Design

## Goal

Allow a user to add category synonyms such as `Kavajer` while preserving the existing mannequin behavior. Every category, built-in or custom, maps to one existing composition slot. A newly created category is immediately usable for the current item and remains available in later item editors for the same user.

## Scope and non-goals

This change covers category creation from the item editor, persistence, loading, validation, and use of custom categories in item editing and wardrobe filtering. It does not add new mannequin slots, category hierarchy, category deletion, category renaming, or category sharing between users. Built-in categories remain available and retain their current IDs and Swedish labels.

## User experience

The item editor's category picker contains the built-in categories followed by the user's saved custom categories. Its final option is `+ Lägg till kategori…`. Selecting that option opens an inline creation control without losing the item's unsaved edits.

The creation control contains:

- a required category name;
- a required slot select using the existing slot labels: `Överdelar`, `Underdelar`, `Klänningar`, `Ytterplagg`, `Skor`, and `Accessoarer`;
- `Avbryt` and `Lägg till` actions.

Names are trimmed and compared case-insensitively within the current user's categories. Blank names and duplicates are rejected with an accessible error. On success, the new category is added to the shared category list, selected for the item, and saved with the item's other edits. If creation fails, the item remains editable and the error is shown in the creation control.

Wardrobe category navigation derives its options from built-ins plus saved custom categories. As today, navigation can hide categories with no active items; the category picker remains the authoritative place where every saved category is always available. A custom category uses its persisted slot for outfit composition and item updates.

## Data model

Add an owner-scoped `public.wardrobe_categories` table:

- `id uuid primary key default gen_random_uuid()`;
- `owner_id uuid not null references public.profiles(id) on delete cascade`;
- `name text not null check (char_length(trim(name)) between 1 and 80)`;
- `slot text not null check (slot in ('top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'))`;
- timestamps using the existing `created_at`/`updated_at` conventions;
- case-insensitive unique index on `(owner_id, lower(trim(name)))`.

Enable RLS and allow authenticated owners to select, insert, update, and delete only their own category rows. The first implementation does not expose rename or delete UI, but the policies and repository boundary should not require a later schema redesign.

Built-in categories stay in `src/domain/slots.js` and are represented with a `builtIn: true` marker or equivalent. Custom category objects use the same `{ id, label, slot }` shape so picker, filter, and composition consumers do not need separate rendering paths. The `all` navigation pseudo-category is not persisted.

Wardrobe items continue to store the category ID in `wardrobe_items.category` and the derived slot in `wardrobe_items.slot`. Replace the fixed category check and hard-coded `wardrobe_slot_for_category` mapping with validation against the owner-visible category definition, while retaining the existing slot check. Item RPCs must verify that the category belongs to the caller and that the supplied slot matches its definition.

## Application data flow

The repository gains:

- `listCategories()` returning built-ins plus the authenticated user's custom categories;
- `createCategory({ name, slot })` inserting and returning a normalized category;
- category lookup/validation used by `updateItem` so custom IDs resolve to their persisted slot.

`App` loads categories alongside labels when a repository is selected. It owns the category snapshot and appends a successfully created category immediately, using the same repository-scoped synchronization pattern as labels and items. Repository doubles that do not implement category methods degrade to built-ins so existing isolated views and tests remain usable.

`WardrobeView` receives the complete category list. It passes that list and `onCreateCategory` into `ItemEditorDialog`, derives navigation options from categories plus the current item set, and keeps the existing active-category fallback behavior. When an item is saved with a custom category, the returned item carries the persisted slot and category ID; no client-side slot guess is permitted.

`ItemEditorDialog` maintains a small local creation state. Choosing the add option opens the form; successful creation resets the select to the new category and leaves all other draft fields intact. Cancelling restores the prior category selection.

## Error handling and consistency

- The database is the final authority for ownership, name uniqueness, and valid slots.
- Duplicate-name conflicts are translated into a clear Swedish message in the creation form.
- If category loading fails, the item editor remains usable with built-ins and shows a non-destructive category status; saving an item with a custom category is disabled unless the category definition is known.
- If a category is created successfully but the subsequent item save fails, the category remains available and the item draft stays open so the user can retry.
- Repository and App updates are guarded by the current repository identity, preventing a late response from one signed-in owner from mutating another owner's snapshot.

## Testing

Add focused tests for:

- category-domain normalization and built-in/custom merging;
- repository list/create behavior, duplicate and invalid-slot errors, and custom-slot resolution during `updateItem`;
- database RLS, owner isolation, case-insensitive uniqueness, and item category-slot validation;
- item editor creation flow, validation, cancellation, immediate selection, and preservation of unsaved fields;
- App category loading and append-on-create synchronization;
- wardrobe navigation and filtering with a custom category, including the empty-category visibility rule;
- existing built-in category behavior and repository test doubles.

## Acceptance criteria

1. A user can create `Kavajer` from an item's category picker and choose `Ytterplagg`.
2. The new category is selected for that item without resetting other edits.
3. A later item editor for the same user offers `Kavajer`.
4. Items assigned to `Kavajer` compose in the outerwear slot and persist `slot = 'outerwear'`.
5. Another user cannot read, create conflicts with, or assign the first user's custom categories.
6. Built-in categories, existing items, outfits, filters, and imports keep their current behavior.
