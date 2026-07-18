# Wearit Season and Theme Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private, owner-managed season and theme labels to clothes and saved outfits, with one responsive filter shared by Wardrobe, Dress, and Outfits for the current browser session.

**Architecture:** Store labels and explicit item/outfit assignments in owner-scoped Supabase tables. Load labels and assignment IDs through the repository, keep the active filter in `App`, and use pure domain functions plus reusable controls in each view. Outfit saves persist their own editable labels; Dress filters only the garment tray and leaves the mannequin composition untouched.

**Tech Stack:** React 19, Vite, Vitest/Testing Library, plain CSS, Supabase/PostgreSQL with RLS and pgTAP database tests.

---

## Working constraints

- Work directly in `/home/adam/Dev/Lab/Wearit`; Adam explicitly does not want a worktree for this private v1 project.
- Read `docs/superpowers/specs/2026-07-18-wearit-season-theme-labels-design.md` before changing code. It is the behavior contract for this plan.
- Development is feature-first. Implement each working vertical slice, then add the focused regression tests listed here; strict TDD is not required.
- Preserve the category-hiding and color-filter behavior committed in `70c7261` (`feat: hide empty categories and add a colour filter`). Label filtering must compose with it, not replace it.
- Do not use `git add -A`. Stage only the files named in the current task so unrelated or concurrent work is never swept into a feature commit.
- Do not modify existing applied migrations or the import-bundle format. Add one forward-only migration.
- Do not add AI, OpenAI, weather, or deployment secrets. This feature is ordinary application and database code.

## Public shapes to keep consistent

Use these shapes throughout the implementation:

```js
// Repository/domain label
{
  id: "uuid",
  kind: "season" | "theme",
  seasonKey: "spring" | "summer" | "autumn" | "winter" | null,
  name: "Summer" | "Rainy day",
  locked: true | false,
}

// Attached to every returned wardrobe item and outfit
labelIds: ["label-uuid"]

// Owned by App; intentionally not persisted
{
  selectedSeasonIds: [],
  selectedThemeIds: [],
}
```

Component callbacks should accept/return whole label records only for theme management; assignments and filters use stable UUIDs.

## Task 0: Protect the current baseline

**Files:** None.

- [ ] From `/home/adam/Dev/Lab/Wearit`, inspect the current branch and changes:

  ```bash
  git status --short --branch
  git diff -- src/features/wardrobe/WardrobeView.jsx src/features/dress/GarmentTray.jsx src/styles.css
  ```

  Expected: branch `codex/wearit-v1`; the working tree is clean before the plan implementation starts.

- [ ] Run the current app suite and build before label work:

  ```bash
  npm test
  npm run build
  ```

  Expected: both exit 0. If a current test fails, record it before editing so it is not mistaken for a label regression.

- [ ] If new concurrent changes appear after this checkpoint, stop and inspect overlap before editing. Never sweep them into a label commit.

## Task 1: Add the pure label and matching rules

**Files:**

- Create: `src/domain/labels.js`
- Create: `src/domain/labels.test.js`

- [ ] Implement the domain module first. Keep all matching semantics here so the three views cannot drift:

  ```js
  export const SEASON_DEFINITIONS = [
    { key: "spring", name: "Spring", displayName: "Vår" },
    { key: "summer", name: "Summer", displayName: "Sommar" },
    { key: "autumn", name: "Autumn", displayName: "Höst" },
    { key: "winter", name: "Winter", displayName: "Vinter" },
  ];

  export function emptyLabelFilter() {
    return { selectedSeasonIds: [], selectedThemeIds: [] };
  }

  export function labelsByKind(labels = []) {
    return {
      seasons: labels
        .filter((label) => label.kind === "season")
        .sort((left, right) => {
          const order = SEASON_DEFINITIONS.map(({ key }) => key);
          return order.indexOf(left.seasonKey) - order.indexOf(right.seasonKey);
        }),
      themes: labels
        .filter((label) => label.kind === "theme")
        .sort((left, right) => left.name.localeCompare(right.name, "sv")),
    };
  }

  export function labelDisplayName(label) {
    if (label.kind !== "season") return label.name;
    return SEASON_DEFINITIONS.find(({ key }) => key === label.seasonKey)?.displayName
      ?? label.name;
  }

  export function isLabelFilterActive(filter) {
    return filter.selectedSeasonIds.length > 0 || filter.selectedThemeIds.length > 0;
  }

  export function sanitizeLabelFilter(filter, labels) {
    const seasonIds = new Set(labels.filter((label) => label.kind === "season").map((label) => label.id));
    const themeIds = new Set(labels.filter((label) => label.kind === "theme").map((label) => label.id));
    const uniqueValid = (ids = [], validIds) => [...new Set(ids)].filter((id) => validIds.has(id));
    return {
      selectedSeasonIds: uniqueValid(filter?.selectedSeasonIds, seasonIds),
      selectedThemeIds: uniqueValid(filter?.selectedThemeIds, themeIds),
    };
  }

  export function matchesLabelFilter(entry, filter) {
    const ids = new Set(entry.labelIds ?? []);
    const seasons = filter.selectedSeasonIds ?? [];
    const themes = filter.selectedThemeIds ?? [];
    const seasonMatches = seasons.length === 0 || seasons.some((id) => ids.has(id));
    const themeMatches = themes.length === 0 || themes.some((id) => ids.has(id));
    return seasonMatches && themeMatches;
  }

  export function sharedLabelIds(items = []) {
    if (items.length === 0) return [];
    const remaining = new Set(items[0].labelIds ?? []);
    for (const item of items.slice(1)) {
      const itemIds = new Set(item.labelIds ?? []);
      for (const id of remaining) if (!itemIds.has(id)) remaining.delete(id);
    }
    return [...remaining];
  }
  ```

- [ ] Add focused Vitest coverage for:

  - no selection matches labeled and unlabeled entries;
  - Summer + Winter is OR;
  - Rainy day + Birthday is OR;
  - Summer + Rainy day is AND across the two groups;
  - unlabeled entries fail only when a filter is active;
  - `sharedLabelIds` returns the intersection, including no-items and one-item cases;
  - sanitization removes deleted, duplicate, unknown, and wrong-kind IDs;
  - seasons sort in Spring/Summer/Autumn/Winter order and display in Swedish.

- [ ] Run the focused test:

  ```bash
  npx vitest run src/domain/labels.test.js
  ```

  Expected: all label-domain tests pass.

- [ ] Commit only these files:

  ```bash
  git add src/domain/labels.js src/domain/labels.test.js
  git commit -m "feat: add season and theme label rules"
  ```

## Task 2: Add the owner-scoped database model and atomic assignment RPCs

**Files:**

- Create: `supabase/migrations/202607180003_season_theme_labels.sql`
- Create: `supabase/tests/database/season_theme_labels.test.sql`

- [ ] Create `public.wardrobe_labels` with the exact invariants from the design:

  ```sql
  create table public.wardrobe_labels (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references public.profiles(id) on delete cascade,
    kind text not null check (kind in ('season', 'theme')),
    season_key text,
    name text not null check (name = trim(name) and char_length(name) between 1 and 80),
    normalized_name text generated always as (lower(trim(name))) stored,
    locked boolean not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (owner_id, id),
    unique (owner_id, season_key),
    check (
      (kind = 'season' and season_key in ('spring', 'summer', 'autumn', 'winter') and locked)
      or (kind = 'theme' and season_key is null and not locked)
    )
  );

  create unique index wardrobe_labels_owner_theme_name_key
    on public.wardrobe_labels (owner_id, normalized_name)
    where kind = 'theme';
  ```

- [ ] Create `public.wardrobe_item_labels` and `public.outfit_labels` with:

  - `owner_id uuid not null`;
  - item/outfit ID plus `label_id`;
  - primary key on the target ID plus label ID;
  - composite `(owner_id, target_id)` foreign key to the target table;
  - composite `(owner_id, label_id)` foreign key to `wardrobe_labels`;
  - `on delete cascade` on both foreign keys.

  The composite owner keys make cross-owner assignments structurally impossible, even inside privileged functions.

- [ ] Enable RLS on all three tables. Add owner-only `select` policies to all three. On `wardrobe_labels`, add direct `insert`, `update`, and `delete` policies restricted to `auth.uid() = owner_id`, `kind = 'theme'`, `season_key is null`, and `locked = false`. Do not add direct assignment mutation policies.

- [ ] Apply least-privilege grants:

  - `authenticated`: `select` on all three tables;
  - `authenticated`: `insert`, `update(name, updated_at)`, and `delete` on `wardrobe_labels`, with RLS enforcing theme-only mutation;
  - no assignment-table write grants;
  - no anonymous grants.

- [ ] Seed four locked seasons for every existing profile using a cross join over canonical key/name values and `on conflict (owner_id, season_key) do nothing`.

- [ ] Replace `public.create_profile_for_user()` by copying its current definition from `202607170001_wardrobe_foundation.sql` and adding the same four season inserts immediately after profile creation. Keep its existing `security definer`, empty `search_path`, trigger behavior, and execute revokes unchanged.

- [ ] Add a security-definer RPC that updates item metadata and complete label assignment atomically:

  ```sql
  public.update_wardrobe_item_with_labels(
    p_item_id uuid,
    p_name text,
    p_category text,
    p_slot text,
    p_brand text,
    p_size text,
    p_notes text,
    p_colors text[],
    p_tags text[],
    p_anchor_x double precision,
    p_anchor_y double precision,
    p_scale double precision,
    p_rotation_degrees double precision,
    p_layer_order integer,
    p_label_ids uuid[]
  ) returns uuid
  ```

  Inside the function:

  1. require `auth.uid()`;
  2. normalize a null label array to an empty `uuid[]`;
  3. reject duplicate label IDs;
  4. lock and verify that the item belongs to the caller;
  5. verify that every submitted label belongs to the caller;
  6. perform the existing editable metadata update;
  7. delete the item's current assignment rows and insert the submitted set;
  8. return the item ID.

  Preserve the existing application validation for category-to-slot mapping. The database still validates ownership, foreign labels, and all existing column constraints.

- [ ] Add a security-definer wrapper for the current five-argument outfit function:

  ```sql
  public.save_outfit_with_labels(
    p_outfit_id uuid,
    p_name text,
    p_item_ids uuid[],
    p_layer_orders integer[],
    p_thumbnail_path text,
    p_label_ids uuid[]
  ) returns uuid
  ```

  The wrapper must call:

  ```sql
  v_outfit_id := public.save_outfit(
    p_outfit_id,
    p_name,
    p_item_ids,
    p_layer_orders,
    p_thumbnail_path
  );
  ```

  Then validate unique, caller-owned labels and replace `outfit_labels` for `v_outfit_id` in the same transaction. Reusing `save_outfit` preserves its item, slot, layer, archive, thumbnail-path, and ownership validation.

- [ ] For both new RPCs:

  - use `security definer set search_path = ''`;
  - schema-qualify every relation/function;
  - revoke execute from `PUBLIC` and `anon`;
  - grant execute only to `authenticated`.

- [ ] Write a pgTAP test that proves the high-value invariants:

  - four seasons are created for an existing profile and for a newly inserted auth user;
  - season keys, canonical names, and `locked` values are correct;
  - another user cannot read labels or assignments under RLS;
  - a caller can create/rename/delete its theme but cannot mutate a locked season;
  - blank and case-insensitive duplicate theme names fail;
  - item assignment accepts multiple owned labels and fully replaces the old set;
  - item assignment rejects a foreign item and a foreign label;
  - outfit assignment accepts multiple owned labels and fully replaces the old set;
  - outfit assignment rejects a foreign outfit/label;
  - deleting a theme cascades assignments but preserves the wardrobe item, outfit, and wear event;
  - the new functions have empty `search_path`, are security definers, and expose only authenticated execute.

- [ ] Reset and run the local database tests:

  ```bash
  npm run test:db
  ```

  Expected: the migration applies from scratch and all old plus new pgTAP files pass. Do not accept a test that runs only the new file while breaking an older migration test.

- [ ] Commit only migration and database test:

  ```bash
  git add supabase/migrations/202607180003_season_theme_labels.sql supabase/tests/database/season_theme_labels.test.sql
  git commit -m "feat: persist owner-scoped wardrobe labels"
  ```

## Task 3: Teach the repository to load and save labels

**Files:**

- Modify: `src/data/wardrobeRepository.js`
- Modify: `src/data/wardrobeRepository.test.js`
- Modify: `src/data/wardrobeRepository.outfits.test.js`

- [ ] Add small mappers near the existing repository helpers:

  ```js
  function assignmentIds(rows = []) {
    return rows.map((row) => row.label_id);
  }

  function mapLabel(row) {
    return {
      id: row.id,
      kind: row.kind,
      seasonKey: row.season_key,
      name: row.name,
      locked: row.locked,
    };
  }
  ```

- [ ] Change active/archive item reads from `.select("*")` to:

  ```js
  .select("*, wardrobe_item_labels(label_id)")
  ```

  Map each returned item to `labelIds: assignmentIds(item.wardrobe_item_labels)` and remove `wardrobe_item_labels` from the public object. Keep product-image loading, signed URLs, ordering, archived options, and primary-image fallback unchanged.

- [ ] Expand `OUTFIT_SELECT` to include `outfit_labels(label_id)`. In `signOutfits`, expose `labelIds` and remove the nested assignment rows. Keep ordered outfit items and signed thumbnails unchanged.

- [ ] Add repository operations:

  ```js
  listLabels()
  createTheme(name)
  renameTheme(labelId, name)
  deleteTheme(labelId)
  ```

  `listLabels` orders seasons by `season_key` only as a stable DB fallback; the domain/UI performs the canonical season order. `createTheme` calls `authenticatedOwnerId()` and inserts `{ owner_id, kind: "theme", season_key: null, locked: false, name: name.trim() }`. Rename/delete scope by ID plus `kind = "theme"` and `locked = false`. Theme mutations return `mapLabel(data)` where applicable. Export all four methods in the repository return object.

- [ ] Replace the direct item-table update in `updateItem(item)` with `update_wardrobe_item_with_labels`. Pass every currently editable field, the category-derived slot, and `p_label_ids: item.labelIds ?? []`. After the RPC succeeds, return the original item merged with normalized editable fields and `labelIds`, so `App` can update its cache without re-signing assets.

- [ ] Change the outfit signature to:

  ```js
  saveOutfit({ id, name, items, thumbnailBlob, labelIds = [] })
  ```

  Call `save_outfit_with_labels` instead of `save_outfit` and pass `p_label_ids`. Preserve the current immutable thumbnail upload, rollback cleanup, obsolete thumbnail cleanup, refetch, and committed-but-refresh-failed behavior. Include `labelIds` in the optimistic fallback result.

- [ ] Extend repository unit tests with assertions that:

  - item and outfit nested assignment rows map to `labelIds`;
  - `listLabels` maps snake case to camel case;
  - theme create/rename/delete use owner-protected label-table operations and trim names;
  - item update calls the new RPC with the complete label set and all editable fields;
  - outfit save calls `save_outfit_with_labels` with labels without regressing layer order or thumbnail cleanup;
  - the committed fallback retains `labelIds`.

- [ ] Run repository tests:

  ```bash
  npx vitest run src/data/wardrobeRepository.test.js src/data/wardrobeRepository.outfits.test.js src/data/wardrobeRepository.outfits.quality.test.js
  ```

  Expected: all repository, thumbnail-transaction, and new label cases pass.

- [ ] Commit explicit paths only:

  ```bash
  git add src/data/wardrobeRepository.js src/data/wardrobeRepository.test.js src/data/wardrobeRepository.outfits.test.js
  git commit -m "feat: load and save wardrobe labels"
  ```

## Task 4: Build reusable filter, picker, and theme-management controls

**Files:**

- Create: `src/features/labels/LabelFilter.jsx`
- Create: `src/features/labels/LabelFilter.test.jsx`
- Create: `src/features/labels/LabelPicker.jsx`
- Create: `src/features/labels/LabelPicker.test.jsx`
- Create: `src/features/labels/ThemeManager.jsx`
- Create: `src/features/labels/ThemeManager.test.jsx`
- Create: `src/features/labels/labels.css`
- Modify: `src/styles.css`

- [ ] Implement `LabelFilter` with this contract:

  ```jsx
  <LabelFilter
    labels={labels}
    value={labelFilter}
    onChange={setLabelFilter}
    loading={labelsLoading}
    error={labelsError}
    visibleCount={visibleCount}
    totalCount={totalCount}
  />
  ```

  Required behavior:

  - a compact `Filter` trigger with the selected count;
  - a controlled panel with `Säsong` and `Tema` groups;
  - Swedish fixed-season names via `labelDisplayName`;
  - checkbox/toggle semantics that preserve multi-select;
  - removable selected chips outside or directly below the trigger;
  - `Rensa alla` calling `emptyLabelFilter()`;
  - `X av Y` count only when a filter is active;
  - Escape and outside-click close while idle;
  - an inline load error that does not imply the wardrobe is empty;
  - unique `aria-label`/`aria-expanded` values when several hidden application sections remain mounted.

- [ ] Implement `LabelPicker` as a controlled assignment editor:

  ```jsx
  <LabelPicker
    labels={labels}
    selectedIds={selectedLabelIds}
    onChange={setSelectedLabelIds}
    disabled={pending}
  />
  ```

  It renders separate season/theme groups, supports zero or many selections, removes stale IDs when `labels` changes, and never identifies a label by display name.

- [ ] Implement `ThemeManager` with:

  ```jsx
  <ThemeManager
    themes={themes}
    onCreate={createTheme}
    onRename={renameTheme}
    onDelete={deleteTheme}
    disabled={pending}
  />
  ```

  Requirements:

  - inline create input and error;
  - inline rename for exactly one theme at a time;
  - two-step in-UI delete confirmation, matching `ImportAdminView` rather than `window.confirm`;
  - confirmation copy explicitly says clothes and outfits remain;
  - server duplicate/blank errors stay visible and preserve the attempted text;
  - callbacks resolve with the created/renamed label record.

- [ ] Style the controls in `labels.css`:

  - use existing Wearit colors, border widths, typography, and square-button language;
  - desktop panel/popover has a bounded width and does not cover navigation;
  - at the existing phone breakpoint, use a fixed full-width bottom sheet with a safe-area bottom inset, scrollable contents, and at least 44px touch targets;
  - selected states must not rely on color alone;
  - chip rows wrap without horizontal page overflow.

- [ ] Add `@import "./features/labels/labels.css";` alongside the existing feature stylesheet imports at the top of `src/styles.css`. Preserve the committed color-filter rules already in that file.

- [ ] Add focused component tests for multi-select, removable chips, clear all, count display, season localization, picker changes, inline duplicate errors, rename, and two-step deletion.

- [ ] Run label component tests:

  ```bash
  npx vitest run src/features/labels
  ```

  Expected: all reusable label-control tests pass.

- [ ] Commit only the new label feature files and the CSS import:

  ```bash
  git add src/features/labels
  git add src/styles.css
  git commit -m "feat: add responsive wardrobe label controls"
  ```

## Task 5: Own shared labels/filter state in App and wire Wardrobe item settings

**Files:**

- Modify: `src/App.jsx`
- Modify: `src/features/wardrobe/WardrobeView.jsx`
- Modify: `src/features/wardrobe/WardrobeView.test.jsx`
- Modify: `src/features/wardrobe/ItemEditorDialog.jsx`
- Modify: `src/features/wardrobe/ItemEditorDialog.test.jsx`
- Modify: `src/styles.css`
- Create: `src/features/labels/App.labels.test.jsx`

- [ ] In `App`, add state scoped to the active repository:

  ```js
  const [labelsState, setLabelsState] = useState(() => ({
    repository: baseRepository,
    labels: [],
    loading: true,
    error: "",
  }));
  const [labelFilter, setLabelFilter] = useState(emptyLabelFilter);
  ```

  Load `baseRepository.listLabels()` once per repository, ignore stale results from replaced repositories, and keep the normal application shell visible on failure. Do not use localStorage; remount/reload must restore All.

  Existing tests inject deliberately small repository doubles. If `listLabels` is absent, treat labels as an empty successfully loaded list. Do not turn an unrelated old test or a future read-only repository into a permanent loading state. Reset the filter to All when `baseRepository` changes so IDs can never leak between owner/repository contexts.

- [ ] Add App-level theme callbacks that call the repository and then update the shared label list:

  - create appends the returned theme;
  - rename replaces it by ID;
  - delete removes it by ID and calls `sanitizeLabelFilter` so a deleted selected theme disappears from the active filter;
  - errors are rethrown for `ThemeManager` to render.

- [ ] Pass the same `labels`, `labelFilter`, `onLabelFilterChange`, loading/error state, and theme callbacks to Wardrobe, Dress, Outfits, and `SaveOutfitDialog`.

  Give the new view/dialog props safe defaults (`labels = []`, `labelFilter = emptyLabelFilter()`, no-op filter callback, and non-loading state) so existing standalone component tests and degraded repository implementations remain compatible while their focused tests are upgraded.

- [ ] In `WardrobeView`, preserve the current category and color work and make the final predicate explicit:

  ```js
  const visibleItems = items.filter((item) => (
    (activeCategory === "all" || item.category === activeCategory)
    && (activeColor === "all" || itemColorFamilies(item).includes(activeColor))
    && matchesLabelFilter(item, labelFilter)
  ));
  ```

  Render `LabelFilter` near the existing category/color controls and pass `visibleItems.length` plus the active-item total. The category chips and color families are still derived from the full active-item list, so selecting a label does not make controls jump in and out.

- [ ] Pass labels and theme callbacks into `ItemEditorDialog`.

- [ ] In `ItemEditorDialog`:

  - initialize `selectedLabelIds` from `item.labelIds ?? []` whenever a new item opens;
  - render `LabelPicker` below existing descriptive tags (tags remain separate);
  - render `ThemeManager` below the theme picker;
  - after create, automatically add the new theme ID to the current item's selection;
  - after delete, remove the deleted ID from the unsaved selection;
  - include `labelIds: selectedLabelIds` in the existing save payload;
  - disable item saving while labels are loading or failed, because saving an apparently empty picker could erase assignments the owner could not see;
  - keep the dialog open and show existing save error behavior when assignment persistence fails.

- [ ] Add high-value integration tests:

  - All initially shows labeled and unlabeled clothes;
  - category + color + Summer predicates combine with AND;
  - changing a shared filter in Wardrobe is still selected after navigating to Dress/Outfits;
  - remounting `App` returns the filter to All;
  - deleting an active theme sanitizes the shared filter without hiding all items;
  - item settings load multiple labels, save their full replacement set, and auto-select a newly created theme;
  - item saving is blocked if labels could not be loaded;
  - a theme delete removes only the assignment selection, not the item.

- [ ] Run focused integration tests, including existing color tests:

  ```bash
  npx vitest run src/features/labels/App.labels.test.jsx src/features/wardrobe/WardrobeView.test.jsx src/features/wardrobe/ItemEditorDialog.test.jsx
  ```

  Expected: old category/color/editor tests and new label cases pass.

- [ ] Commit only the relevant files. The color baseline is already committed in `70c7261`; stage the complete label integration files after reviewing their diff.

  ```bash
  git add src/App.jsx src/features/wardrobe/ItemEditorDialog.jsx src/features/wardrobe/ItemEditorDialog.test.jsx src/features/labels/App.labels.test.jsx
  git add src/features/wardrobe/WardrobeView.jsx src/features/wardrobe/WardrobeView.test.jsx src/styles.css
  git commit -m "feat: filter wardrobe and edit item labels"
  ```

## Task 6: Filter only the Dress garment tray

**Files:**

- Modify: `src/features/dress/DressingRoom.jsx`
- Modify: `src/features/dress/DressingRoom.test.jsx`
- Modify: `src/features/dress/GarmentTray.jsx`

- [ ] Extend `DressingRoom` props with shared label state and render `LabelFilter` above the tray.

- [ ] Keep the reducer reconciliation effect pointed at the complete `items` prop. Compute a separate list only for display:

  ```js
  const trayItems = useMemo(
    () => items.filter((item) => matchesLabelFilter(item, labelFilter)),
    [items, labelFilter],
  );
  ```

  Pass `trayItems` to `GarmentTray`, but continue passing/searching the full `items` list for loaded outfit reconciliation and selected mannequin garments. This separation is the key safety invariant.

- [ ] Preserve `GarmentTray`'s in-progress populated-category behavior. Its category chips should derive from `trayItems`; if the current tray category becomes empty after a label change, fall back to All without dispatching any mannequin action.

- [ ] Extend the existing test `filters the tray without changing the current composition` to:

  1. place a Summer top and Winter bottom on the mannequin;
  2. filter the tray to Summer;
  3. assert the Winter bottom disappears from the tray;
  4. assert both garments remain rendered on the mannequin and both remain in Save/Wear selection;
  5. clear the filter and assert the tray item returns.

- [ ] Add a shared-state assertion that a filter selected in Wardrobe is already active when navigating to Dress.

- [ ] Run Dress tests:

  ```bash
  npx vitest run src/features/dress/DressingRoom.test.jsx src/features/dress/DressingRoom.quality.test.jsx src/features/dress/App.repositoryMutation.test.jsx
  ```

  Expected: filtering never changes composition, undo history, loaded-outfit provenance, or repository reconciliation.

- [ ] Commit the Dress slice. The existing category behavior is already committed; stage the complete integrated files after reviewing their diff:

  ```bash
  git add src/features/dress/DressingRoom.jsx src/features/dress/DressingRoom.test.jsx src/features/dress/GarmentTray.jsx
  git commit -m "feat: filter the dressing-room garment tray"
  ```

## Task 7: Filter saved outfits and persist editable outfit labels

**Files:**

- Modify: `src/features/outfits/OutfitsView.jsx`
- Modify: `src/features/outfits/OutfitsView.test.jsx`
- Modify: `src/features/outfits/SaveOutfitDialog.jsx`
- Modify: `src/features/outfits/SaveOutfitDialog.quality.test.jsx`
- Modify: `src/features/outfits/outfits.css`
- Modify: `src/App.jsx`

- [ ] In `OutfitsView`, filter saved outfits by their own `outfit.labelIds`, never by recalculating item labels. Render the shared `LabelFilter`, show visible/total counts while filtered, and keep `needs_attention`/archived-item behavior unchanged.

- [ ] Extend `SaveOutfitDialog` with:

  ```jsx
  labels={labels}
  labelsLoading={labelsLoading}
  labelsError={labelsError}
  ```

  Add controlled `selectedLabelIds` and render `LabelPicker` in the save form. Disable the final save while labels are loading, label loading failed, or duplicate detection is unresolved; an intentionally empty assignment is valid only after labels loaded successfully.

- [ ] Make initialization rules explicit:

  - brand-new composition: `sharedLabelIds(selection)`;
  - exact saved outfit update: that exact outfit's existing `labelIds`;
  - changed composition loaded from an outfit: default variation labels to `sharedLabelIds(selection)`;
  - existing outfit update: preserve that outfit's current `labelIds`, even if its item labels changed.

- [ ] The current UI can expose update and variation actions together. Add an explicit `saveMode` (`"update" | "variation"`) when both are available:

  - choosing Update initializes from `sourceOutfit.labelIds` and passes its ID;
  - choosing New variation initializes from `sharedLabelIds(selection)` and passes no ID;
  - changing modes resets the picker to that mode's documented default, making the change visible rather than silently carrying the wrong metadata;
  - after initialization, every suggestion remains editable.

- [ ] Pass `labelIds: selectedLabelIds` into `repository.saveOutfit`. The repository handles both update replacement and new-outfit assignment atomically with the outfit row/items.

- [ ] Add component tests for:

  - Outfits All includes labeled and unlabeled saved outfits;
  - selected season/theme rules filter by saved outfit labels;
  - a new outfit starts with the intersection of all selected item labels;
  - one item having a label is insufficient for a two-item suggestion;
  - exact update preserves manually saved outfit labels;
  - variation uses fresh intersection suggestions and no source outfit ID;
  - switching mode resets to the correct documented default;
  - edits to suggestions are sent unchanged to `saveOutfit`;
  - outfit saving is blocked if labels could not be loaded;
  - duplicate-detection and thumbnail-failure safeguards still work.

- [ ] Run outfit tests:

  ```bash
  npx vitest run src/features/outfits src/data/wardrobeRepository.outfits.test.js src/data/wardrobeRepository.outfits.quality.test.js
  ```

  Expected: outfit filters and label-save behavior pass without regressing update IDs, variations, previews, or cleanup.

- [ ] Commit the outfit slice:

  ```bash
  git add src/App.jsx src/features/outfits/OutfitsView.jsx src/features/outfits/OutfitsView.test.jsx src/features/outfits/SaveOutfitDialog.jsx src/features/outfits/SaveOutfitDialog.quality.test.jsx src/features/outfits/outfits.css
  git commit -m "feat: filter and label saved outfits"
  ```

## Task 8: Full verification and responsive acceptance pass

**Files:**

- Modify only if verification finds a defect in files already listed above.

- [ ] Run formatting/lint checks available in the repository:

  ```bash
  npm run check
  ```

  Expected: exit 0 with no new lint errors.

- [ ] Run the complete application suite once, not only focused tests:

  ```bash
  npm test
  ```

  Expected: all Vitest files pass.

- [ ] Run the complete database suite from a clean local Supabase reset:

  ```bash
  npm run test:db
  ```

  Expected: every migration applies and every pgTAP test passes.

- [ ] Produce a production build:

  ```bash
  npm run build
  ```

  Expected: Vite exits 0 and emits `dist/` without missing imports.

- [ ] Start the application and perform the following desktop acceptance pass:

  ```bash
  npm run dev
  ```

  - All initially shows existing unlabeled clothes and outfits.
  - Create `Regn`, rename it, assign it plus Summer to multiple items, and filter using both groups.
  - Confirm category and color filters combine correctly with labels.
  - Switch Wardrobe -> Dress -> Outfits and verify the same selected chips remain.
  - Place garments on the mannequin, change filters, and verify the composition stays intact.
  - Save a new outfit, update it, and save a variation; inspect each label result.
  - Delete the theme and confirm clothes, outfits, thumbnails, and history remain.
  - Reload and confirm the filter resets to All.

- [ ] Repeat the interactive paths at a phone viewport (or a real phone on the local network):

  - bottom sheet fits above browser chrome and safe area;
  - no horizontal overflow;
  - filter chips wrap;
  - all controls are easy to tap;
  - editor and save dialogs remain scrollable with the keyboard open;
  - desktop layout remains equally usable.

- [ ] Before a hosted test or Vercel release, apply `202607180003_season_theme_labels.sql` to the linked Supabase project with `npx supabase db push`. This is a remote state change: inspect the linked project and get Adam approval before running it. No new Vercel environment variables are required.

- [ ] Inspect the final diff and history:

  ```bash
  git status --short
  git diff --check
  git log --oneline -8
  ```

  Expected: no accidental import assets, secrets, generated `dist/`, or unrelated files are staged; `git diff --check` is clean.

- [ ] If acceptance required fixes, add focused regression coverage for each real defect, rerun the relevant focused test plus the complete test/build commands, and commit only those fixes:

  ```bash
  git commit -m "fix: complete season and theme label flow"
  ```

## Definition of done

- Existing content is unchanged and visible under All.
- Four fixed localized seasons and owner-created themes can be assigned to any item and saved outfit.
- OR-within/AND-across semantics are identical in Wardrobe, Dress, and Outfits.
- The active label filter is shared during the session and resets on reload.
- Category and color filters still work and compose with labels.
- Dress filtering never mutates the mannequin composition.
- New outfit suggestions use intersection; updates preserve saved labels; variations use fresh editable suggestions.
- Theme deletion removes only assignments and sanitizes the active filter.
- Owner isolation and locked seasons are proven by database tests.
- Full app tests, full database tests, check, production build, and phone/desktop acceptance all pass.
