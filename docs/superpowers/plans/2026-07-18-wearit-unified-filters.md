# Wearit Unified Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the completed season/theme-only `LabelFilter` and separate single-color row with one responsive, shared, multi-select Color/Season/Theme filter while preserving local garment categories and all completed label-assignment work.

**Architecture:** Add a pure advanced-filter domain that owns view-scoped matching, counting, clearing, and sanitization. `App` owns one session-only advanced-filter state and the available color families; a reusable `UnifiedFilter` projects only the groups applicable to each view. Wardrobe and Dress apply Color/Season/Theme, Outfits applies only Season/Theme while retaining Color in shared state.

**Tech Stack:** React 19, Vite, Vitest/Testing Library, plain CSS, existing Wearit color-family domain, existing Supabase-backed season/theme labels.

---

## Working baseline and constraints

- Start from the clean completed implementation at `972c9dd` on `codex/wearit-v1`.
- Read `docs/superpowers/specs/2026-07-18-wearit-unified-filters-design.md`; it is authoritative for this delta.
- The previous season/theme plan is already implemented. Do not repeat its database, repository, picker, theme-manager, item-assignment, or outfit-assignment tasks.
- Keep `src/features/labels/LabelPicker.jsx`, `ThemeManager.jsx`, their tests, and their assignment flows intact.
- No worktree: Adam explicitly wants direct development in this private v1 checkout.
- Feature-first development is intentional. Implement each slice, then add the focused regression coverage listed here; strict TDD is not required.
- Do not use `git add -A`. Stage only named files after reviewing their diffs.
- Current verified baseline: `npm test` passes 30 files / 271 tests; `npm run build` succeeds with the existing non-blocking bundle-size warning.
- No database migration, import-format change, API, AI integration, weather service, or deployment variable belongs in this delta.

## Target public shapes

```js
// App-owned, session-only state
{
  selectedColorIds: ["green"],
  selectedSeasonIds: ["season-uuid"],
  selectedThemeIds: ["theme-uuid"],
}

// Groups supported by UnifiedFilter
"color" | "season" | "theme"
```

Wardrobe and Dress use `ITEM_FILTER_GROUPS`; Outfits uses `OUTFIT_FILTER_GROUPS`. Garment category remains separate, single-select, and local to each view.

## Task 0: Reconfirm the completed baseline

**Files:** None.

- [ ] Verify the exact starting state:

  ```bash
  cd /home/adam/Dev/Lab/Wearit
  git status --short --branch
  git log -1 --oneline
  ```

  Expected: branch `codex/wearit-v1`, clean working tree, HEAD `972c9dd feat: filter and label saved outfits` or a later documentation-only commit.

- [ ] Run the existing suite and build before editing:

  ```bash
  npm test
  npm run build
  ```

  Expected: 30 test files / 271 tests pass and Vite builds successfully. Record any drift before changing code.

- [ ] Confirm the delta boundary:

  ```bash
  rg -n "LabelFilter|activeColor|color-filter|color-chip" src
  ```

  Expected: `LabelFilter` is integrated in Wardrobe, Dress, and Outfits; `activeColor` and the separate color row exist only in Wardrobe.

## Task 1: Add the pure advanced-filter domain

**Files:**

- Create: `src/domain/filters.js`
- Create: `src/domain/filters.test.js`
- Keep unchanged for now: `src/domain/labels.js`

- [ ] Create `src/domain/filters.js` with the complete shared rules:

  ```js
  import { itemColorFamilies } from "./colors.js";

  export const FILTER_GROUPS = Object.freeze({
    COLOR: "color",
    SEASON: "season",
    THEME: "theme",
  });

  export const ITEM_FILTER_GROUPS = Object.freeze([
    FILTER_GROUPS.COLOR,
    FILTER_GROUPS.SEASON,
    FILTER_GROUPS.THEME,
  ]);

  export const OUTFIT_FILTER_GROUPS = Object.freeze([
    FILTER_GROUPS.SEASON,
    FILTER_GROUPS.THEME,
  ]);

  const SELECTION_KEY = Object.freeze({
    [FILTER_GROUPS.COLOR]: "selectedColorIds",
    [FILTER_GROUPS.SEASON]: "selectedSeasonIds",
    [FILTER_GROUPS.THEME]: "selectedThemeIds",
  });

  export function selectionKeyForGroup(group) {
    const key = SELECTION_KEY[group];
    if (!key) throw new Error(`Unknown filter group: ${group}`);
    return key;
  }

  export function emptyAdvancedFilter() {
    return {
      selectedColorIds: [],
      selectedSeasonIds: [],
      selectedThemeIds: [],
    };
  }

  function normalizedFilter(filter) {
    return {
      selectedColorIds: [...new Set(filter?.selectedColorIds ?? [])],
      selectedSeasonIds: [...new Set(filter?.selectedSeasonIds ?? [])],
      selectedThemeIds: [...new Set(filter?.selectedThemeIds ?? [])],
    };
  }

  export function activeAdvancedFilterCount(filter, groups = ITEM_FILTER_GROUPS) {
    const normalized = normalizedFilter(filter);
    return groups.reduce(
      (total, group) => total + normalized[selectionKeyForGroup(group)].length,
      0,
    );
  }

  export function isAdvancedFilterActive(filter, groups = ITEM_FILTER_GROUPS) {
    return activeAdvancedFilterCount(filter, groups) > 0;
  }

  export function clearAdvancedFilterGroups(filter, groups = ITEM_FILTER_GROUPS) {
    const next = normalizedFilter(filter);
    for (const group of groups) next[selectionKeyForGroup(group)] = [];
    return next;
  }

  export function sanitizeAdvancedFilter(filter, available = {}) {
    const next = normalizedFilter(filter);

    if (Object.hasOwn(available, "colors")) {
      const validColorIds = new Set((available.colors ?? []).map((color) => color.id));
      next.selectedColorIds = next.selectedColorIds.filter((id) => validColorIds.has(id));
    }

    if (Object.hasOwn(available, "labels")) {
      const seasons = new Set(
        (available.labels ?? []).filter((label) => label.kind === "season").map((label) => label.id),
      );
      const themes = new Set(
        (available.labels ?? []).filter((label) => label.kind === "theme").map((label) => label.id),
      );
      next.selectedSeasonIds = next.selectedSeasonIds.filter((id) => seasons.has(id));
      next.selectedThemeIds = next.selectedThemeIds.filter((id) => themes.has(id));
    }

    return next;
  }

  export function matchesAdvancedFilter(
    entry,
    filter,
    groups = ITEM_FILTER_GROUPS,
  ) {
    const normalized = normalizedFilter(filter);
    const labelIds = new Set(entry?.labelIds ?? []);
    const candidates = {
      [FILTER_GROUPS.COLOR]: itemColorFamilies(entry),
      [FILTER_GROUPS.SEASON]: labelIds,
      [FILTER_GROUPS.THEME]: labelIds,
    };

    return groups.every((group) => {
      const selected = normalized[selectionKeyForGroup(group)];
      return selected.length === 0 || selected.some((id) => candidates[group].has(id));
    });
  }
  ```

  This produces OR within each selected array and AND because every applicable group must pass.

- [ ] Add `src/domain/filters.test.js` with focused cases using stable fixtures:

  ```js
  import { describe, expect, it } from "vitest";
  import {
    ITEM_FILTER_GROUPS,
    OUTFIT_FILTER_GROUPS,
    activeAdvancedFilterCount,
    clearAdvancedFilterGroups,
    emptyAdvancedFilter,
    matchesAdvancedFilter,
    sanitizeAdvancedFilter,
  } from "./filters.js";

  const filter = (overrides = {}) => ({ ...emptyAdvancedFilter(), ...overrides });
  const summer = { id: "s-summer", kind: "season" };
  const rainy = { id: "t-rainy", kind: "theme" };

  describe("matchesAdvancedFilter", () => {
    it("uses OR within colours and AND across colour, season, and theme", () => {
      const active = filter({
        selectedColorIds: ["black", "green"],
        selectedSeasonIds: [summer.id],
        selectedThemeIds: [rainy.id],
      });
      expect(matchesAdvancedFilter(
        { colors: ["#4a8c3f"], labelIds: [summer.id, rainy.id] },
        active,
      )).toBe(true);
      expect(matchesAdvancedFilter(
        { colors: ["#2f5fb0"], labelIds: [summer.id, rainy.id] },
        active,
      )).toBe(false);
      expect(matchesAdvancedFilter(
        { colors: ["#4a8c3f"], labelIds: [summer.id] },
        active,
      )).toBe(false);
    });

    it("ignores colour for outfit groups", () => {
      const active = filter({
        selectedColorIds: ["green"],
        selectedSeasonIds: [summer.id],
      });
      expect(matchesAdvancedFilter(
        { labelIds: [summer.id] },
        active,
        OUTFIT_FILTER_GROUPS,
      )).toBe(true);
    });
  });

  it("counts and clears only applicable groups", () => {
    const active = filter({
      selectedColorIds: ["black", "green"],
      selectedSeasonIds: [summer.id],
      selectedThemeIds: [rainy.id],
    });
    expect(activeAdvancedFilterCount(active, ITEM_FILTER_GROUPS)).toBe(4);
    expect(activeAdvancedFilterCount(active, OUTFIT_FILTER_GROUPS)).toBe(2);
    expect(clearAdvancedFilterGroups(active, OUTFIT_FILTER_GROUPS)).toEqual({
      selectedColorIds: ["black", "green"],
      selectedSeasonIds: [],
      selectedThemeIds: [],
    });
  });

  it("sanitizes only collections supplied by the caller", () => {
    const active = filter({
      selectedColorIds: ["green", "missing", "green"],
      selectedSeasonIds: [summer.id, rainy.id],
      selectedThemeIds: [rainy.id, summer.id],
    });
    expect(sanitizeAdvancedFilter(active, {
      colors: [{ id: "green" }],
      labels: [summer, rainy],
    })).toEqual({
      selectedColorIds: ["green"],
      selectedSeasonIds: [summer.id],
      selectedThemeIds: [rainy.id],
    });
    expect(sanitizeAdvancedFilter(active, { labels: [summer, rainy] }).selectedColorIds)
      .toEqual(["green", "missing"]);
  });
  ```

- [ ] Run the domain suites:

  ```bash
  npx vitest run src/domain/filters.test.js src/domain/colors.test.js src/domain/labels.test.js
  ```

  Expected: new advanced-filter tests and all existing color/label tests pass.

- [ ] Commit only the new domain files:

  ```bash
  git add src/domain/filters.js src/domain/filters.test.js
  git commit -m "feat: add unified filter rules"
  ```

## Task 2: Build `UnifiedFilter` beside the existing control

**Files:**

- Create: `src/features/filters/UnifiedFilter.jsx`
- Create: `src/features/filters/UnifiedFilter.test.jsx`
- Create: `src/features/filters/filters.css`
- Modify: `src/styles.css`
- Keep temporarily: `src/features/labels/LabelFilter.jsx`
- Keep unchanged: `src/features/labels/LabelPicker.jsx`, `ThemeManager.jsx`

- [ ] Create `UnifiedFilter.jsx` as a controlled component with this public API:

  ```jsx
  <UnifiedFilter
    groups={ITEM_FILTER_GROUPS}
    colors={availableColors}
    labels={labels}
    value={advancedFilter}
    onChange={onAdvancedFilterChange}
    loading={labelsLoading}
    error={labelsError}
    visibleCount={visibleItems.length}
    totalCount={items.length}
    resultNoun="plagg"
    context="Garderob"
  />
  ```

- [ ] Base its controlled updates on the Task 1 helpers:

  ```js
  const selectedCount = activeAdvancedFilterCount(value, groups);
  const active = isAdvancedFilterActive(value, groups);

  const toggle = (group, id) => {
    const key = selectionKeyForGroup(group);
    const selected = new Set(value[key]);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    onChange?.({ ...value, [key]: [...selected] });
  };

  const remove = (group, id) => {
    const key = selectionKeyForGroup(group);
    onChange?.({ ...value, [key]: value[key].filter((entry) => entry !== id) });
  };

  const clearApplicable = () => {
    onChange?.(clearAdvancedFilterGroups(value, groups));
  };
  ```

  Never call `emptyAdvancedFilter()` for Clear all: Outfits must preserve Color because Color is not in its `groups` prop.

- [ ] Render one trigger and one panel:

  - Trigger text `Filter`, funnel icon, and badge with `selectedCount`.
  - Summary `X av Y` only when an applicable group is active.
  - Panel heading plus an explicit close button.
  - Color fieldset only when `groups` includes Color and at least two colors exist, or a Color is already selected.
  - Season/Theme fieldsets only when their groups are included.
  - Existing Swedish season localization through `labelDisplayName`.
  - Selected chips outside the panel in group order: Color, Season, Theme.
  - `Rensa alla` invokes `clearApplicable`.
  - Mobile-only sticky button text `Visa ${visibleCount} ${resultNoun}`; it closes without changing selection.

- [ ] Render actual Color swatches plus names in both options and chips:

  ```jsx
  function ColorSwatch({ family }) {
    return (
      <span
        className="unified-filter-swatch"
        style={{ backgroundColor: family.swatch }}
        aria-hidden="true"
      />
    );
  }

  <label className={`unified-filter-option${checked ? " checked" : ""}`}>
    <input
      type="checkbox"
      checked={checked}
      onChange={() => toggle(FILTER_GROUPS.COLOR, family.id)}
    />
    <ColorSwatch family={family} />
    <span>{family.label}</span>
  </label>
  ```

  The visible family name supplies the accessible label. Selection also uses checkbox/checkmark and border state, never swatch color alone.

- [ ] Keep Color usable during label failure. Structure the panel so Color renders independently, then render the label status inside the label portion:

  ```jsx
  {groups.includes(FILTER_GROUPS.COLOR) && colorGroup()}
  {usesLabels && loading && <p>Laddar etiketter…</p>}
  {usesLabels && error && <p role="alert">{error}</p>}
  {usesLabels && !loading && !error && seasonAndThemeGroups()}
  ```

  Do not hide the entire panel behind `loading` or `error` as the current `LabelFilter` does.

- [ ] Preserve the current open/close safeguards:

  - panel state stays local;
  - Escape, explicit close, mobile `Visa X`, and outside pointer close the panel;
  - explicit close/Escape/mobile action returns focus to the trigger;
  - `context` keeps accessible names unique while hidden application sections remain mounted.

- [ ] Create `filters.css` with renamed `unified-filter-*` rules. Move/copy only filter-control styling; Picker and ThemeManager remain in `labels.css`. Required responsive behavior:

  ```css
  .unified-filter-panel {
    position: absolute;
    z-index: 30;
    top: calc(100% + 8px);
    left: 0;
    width: min(390px, calc(100vw - 32px));
    max-height: min(65vh, 520px);
    overflow-y: auto;
  }

  .unified-filter-swatch {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    border-radius: 999px;
    box-shadow: inset 0 0 0 1px rgba(25, 24, 22, .22);
  }

  .unified-filter-mobile-action { display: none; }

  @media (max-width: 640px) {
    .unified-filter-panel {
      position: fixed;
      inset: auto 0 0 0;
      width: 100%;
      max-height: 78vh;
      padding-bottom: env(safe-area-inset-bottom);
    }

    .unified-filter-mobile-action {
      position: sticky;
      bottom: 0;
      display: block;
      width: 100%;
      min-height: 48px;
    }
  }
  ```

  Add wrapping chips, 44px phone targets, panel header, selected-state, status/error, and focus-visible rules using existing Wearit variables.

- [ ] Add the stylesheet import beside current feature imports:

  ```css
  @import "./features/filters/filters.css";
  ```

- [ ] Add focused `UnifiedFilter.test.jsx` coverage:

  - Color options display actual swatch styles and Swedish names.
  - Selecting Green preserves existing Summer/Rainy selections.
  - Two Color checkboxes can remain selected simultaneously.
  - Active Color chip includes swatch and name and can be removed.
  - Badge counts applicable individual selections.
  - `groups={OUTFIT_FILTER_GROUPS}` hides Color/chip, excludes it from badge/count activation, and Clear all preserves `selectedColorIds`.
  - Label error still leaves Color options interactive.
  - Escape and `Visa X plagg` close and restore trigger focus.
  - Summary appears only for applicable active groups.

- [ ] Run the new component tests without removing the old control yet:

  ```bash
  npx vitest run src/features/filters/UnifiedFilter.test.jsx src/features/labels/LabelFilter.test.jsx
  ```

  Expected: both old and new component tests pass during migration.

- [ ] Commit the new reusable control:

  ```bash
  git add src/features/filters src/styles.css
  git commit -m "feat: add unified wardrobe filter control"
  ```

## Task 3: Move advanced state into App and replace Wardrobe filters

**Files:**

- Modify: `src/App.jsx`
- Modify: `src/features/wardrobe/WardrobeView.jsx`
- Modify: `src/features/wardrobe/WardrobeView.test.jsx`
- Modify: `src/features/labels/App.labels.test.jsx`
- Create: `src/features/filters/App.filters.test.jsx`
- Modify: `src/styles.css`

- [ ] In `App.jsx`, replace label-only state/imports:

  ```js
  import { availableColorFamilies } from "./domain/colors.js";
  import {
    emptyAdvancedFilter,
    sanitizeAdvancedFilter,
  } from "./domain/filters.js";

  const [advancedFilter, setAdvancedFilter] = useState(emptyAdvancedFilter);
  ```

  On repository change call `setAdvancedFilter(emptyAdvancedFilter())` exactly where `labelFilter` is currently reset.

- [ ] Derive colors from the complete App item snapshot and sanitize only Color whenever that complete collection changes:

  ```js
  const items = itemSnapshot.repository === baseRepository ? itemSnapshot.items : [];
  const colors = useMemo(() => availableColorFamilies(items), [items]);

  useEffect(() => {
    setAdvancedFilter((current) => sanitizeAdvancedFilter(current, { colors }));
  }, [colors]);
  ```

  The snapshot is populated by the existing repository wrapper. Do not derive colors from a filtered view.

- [ ] Update theme deletion to sanitize labels while preserving Color:

  ```js
  setAdvancedFilter((current) => sanitizeAdvancedFilter(current, { labels: remaining }));
  ```

- [ ] Replace `labelProps` with view filter props while retaining separate theme-management callbacks:

  ```js
  const advancedFilterProps = {
    colors,
    labels,
    advancedFilter,
    onAdvancedFilterChange: setAdvancedFilter,
    labelsLoading,
    labelsError,
  };
  ```

  Wardrobe still receives `onCreateTheme`, `onRenameTheme`, and `onDeleteTheme` for `ItemEditorDialog`. `SaveOutfitDialog` still receives labels/loading/error only. Do not pass theme mutation callbacks into `UnifiedFilter`.

- [ ] In `WardrobeView.jsx`:

  - import `availableColorFamilies` only as a standalone fallback;
  - import `emptyAdvancedFilter`, `ITEM_FILTER_GROUPS`, and `matchesAdvancedFilter`;
  - import `UnifiedFilter`;
  - replace `labelsFilter` props with `colors = null`, `advancedFilter`, and `onAdvancedFilterChange`;
  - remove `activeColor`, `itemFamilies`, `showColorFilter`, its sanitizing effect, `chooseColor`, and the separate `.color-filter` JSX.

  Use complete local items as fallback when the view is rendered outside App tests:

  ```js
  const availableColors = useMemo(
    () => colors ?? availableColorFamilies(items),
    [colors, items],
  );
  ```

- [ ] Apply local category AND the shared advanced predicate:

  ```js
  const visibleItems = useMemo(
    () => items.filter((item) => (
      (activeCategory === "all" || item.category === activeCategory)
      && matchesAdvancedFilter(item, advancedFilter, ITEM_FILTER_GROUPS)
    )),
    [activeCategory, advancedFilter, items],
  );
  ```

  Keep category availability derived from complete `items`, so Color/Season/Theme selections cannot make category buttons disappear.

- [ ] Render `UnifiedFilter` immediately after the existing category row:

  ```jsx
  <UnifiedFilter
    groups={ITEM_FILTER_GROUPS}
    colors={availableColors}
    labels={labels}
    value={advancedFilter}
    onChange={onAdvancedFilterChange}
    loading={labelsLoading}
    error={labelsError}
    visibleCount={visibleItems.length}
    totalCount={items.length}
    resultNoun="plagg"
    context={context}
  />
  ```

- [ ] Remove the old `.color-filter`, `.color-chip`, and `.color-dot` rules from `styles.css`; swatch styling now belongs to `filters.css`.

- [ ] Replace the Wardrobe color tests with unified behavior:

  - One Filter trigger exists and no separate `Filtrera på färg` group exists.
  - Color group is omitted with fewer than two families unless a color is already selected.
  - Green + Red is OR and both checkboxes remain selected.
  - Red + Summer is AND.
  - Advanced filters AND with the local Bottoms category.
  - Category buttons still reflect complete items while results narrow.

- [ ] Keep item-assignment cases in `App.labels.test.jsx`, but update shared-filter helper names from `labelFilter` to `advancedFilter` where the test interacts through App. Do not change `LabelPicker`/`ThemeManager` expectations.

- [ ] Create `App.filters.test.jsx` for App-owned behavior:

  - initial All includes labeled/unlabeled clothes;
  - Green + Summer + Rainy day produces the expected intersection;
  - remount resets Color/Season/Theme to All;
  - repository replacement resets all three arrays;
  - deleting an active theme removes only that theme and preserves selected Color;
  - failed label loading still allows a Color selection to filter Wardrobe.

- [ ] Run Wardrobe/App tests:

  ```bash
  npx vitest run src/features/wardrobe/WardrobeView.test.jsx src/features/labels/App.labels.test.jsx src/features/filters/App.filters.test.jsx
  ```

  Expected: current item-editor/theme tests remain green and unified Wardrobe filtering passes.

- [ ] Commit the App/Wardrobe slice:

  ```bash
  git add src/App.jsx src/features/wardrobe/WardrobeView.jsx src/features/wardrobe/WardrobeView.test.jsx src/features/labels/App.labels.test.jsx src/features/filters/App.filters.test.jsx src/styles.css
  git commit -m "feat: unify wardrobe color and label filters"
  ```

## Task 4: Apply the shared filter to Dress without touching composition

**Files:**

- Modify: `src/features/dress/DressingRoom.jsx`
- Modify: `src/features/dress/DressingRoom.test.jsx`
- Modify: `src/features/dress/GarmentTray.jsx`
- Modify: `src/features/dress/dress.css`

- [ ] Replace label-only DressingRoom props/imports with:

  ```js
  colors = null,
  labels = [],
  advancedFilter = emptyAdvancedFilter(),
  onAdvancedFilterChange = () => {},
  labelsLoading = false,
  labelsError = "",
  ```

  Derive `availableColors = colors ?? availableColorFamilies(items)` for standalone tests.

- [ ] Keep all reducer reconciliation, selection, loaded-outfit provenance, layer movement, Save, Wear, and Undo logic bound to the complete `items` prop. Delete the current `trayItems` label-filter memo; advanced filtering will happen only in `GarmentTray` display logic.

- [ ] Change `GarmentTray` from a pre-filtered-items API to a complete-items plus predicate/render-prop API:

  ```jsx
  <GarmentTray
    items={items}
    selectedIds={selectedIds}
    onSelect={(item) => dispatch({ type: "select", item })}
    itemFilter={(item) => matchesAdvancedFilter(
      item,
      advancedFilter,
      ITEM_FILTER_GROUPS,
    )}
    renderFilter={({ visibleCount, totalCount }) => (
      <UnifiedFilter
        groups={ITEM_FILTER_GROUPS}
        colors={availableColors}
        labels={labels}
        value={advancedFilter}
        onChange={onAdvancedFilterChange}
        loading={labelsLoading}
        error={labelsError}
        visibleCount={visibleCount}
        totalCount={totalCount}
        resultNoun="plagg"
        context={context}
      />
    )}
  />
  ```

- [ ] In `GarmentTray`, preserve category state locally but derive category availability from complete `items`. Apply category and `itemFilter` only to displayed items:

  ```js
  export function GarmentTray({
    items,
    selectedIds,
    onSelect,
    itemFilter = () => true,
    renderFilter = null,
  }) {
    // availableCategoryIds and visibleCategories use complete items
    const visibleItems = useMemo(
      () => items.filter((item) => (
        (effectiveCategory === "all" || item.category === effectiveCategory)
        && itemFilter(item)
      )),
      [effectiveCategory, itemFilter, items],
    );
  }
  ```

  Render the category row first, then `renderFilter?.({ visibleCount: visibleItems.length, totalCount: items.length })`, then the strip. This matches the approved type-first visual hierarchy.

- [ ] Ensure an advanced filter never makes a category chip disappear. If a selected local category still exists in complete items but has zero advanced-filter matches, keep that category selected and show `Inga plagg matchar filtret.` with the filter/chips available. Fall back to All only when complete items no longer contain that category.

- [ ] Update Dress regression coverage:

  - Green + Summer filters only the tray.
  - A filtered-out garment already on the mannequin remains rendered and remains in Save/Wear selection.
  - Changing filters adds no reducer history/Undo step.
  - Clearing chips returns hidden tray items.
  - Category choices remain based on complete items.
  - A Dress-local category selection does not change Wardrobe category state.
  - Color selected in Wardrobe is already selected and applied in Dress.

- [ ] Adjust `dress.css` only for ordering/spacing around the category row, unified filter, and strip. Reuse `filters.css` for the panel and chips; do not duplicate filter styles.

- [ ] Run Dress tests:

  ```bash
  npx vitest run src/features/dress/DressingRoom.test.jsx src/features/dress/DressingRoom.quality.test.jsx src/features/dress/App.repositoryMutation.test.jsx src/features/dress/DressingRoom.outfitSource.test.jsx
  ```

  Expected: filtering changes tray rendering only; mannequin/repository/provenance tests remain green.

- [ ] Commit the Dress slice:

  ```bash
  git add src/features/dress/DressingRoom.jsx src/features/dress/DressingRoom.test.jsx src/features/dress/GarmentTray.jsx src/features/dress/dress.css
  git commit -m "feat: share unified filters with the dressing room"
  ```

## Task 5: Project only Season and Theme into Outfits

**Files:**

- Modify: `src/features/outfits/OutfitsView.jsx`
- Modify: `src/features/outfits/OutfitsView.test.jsx`
- Modify: `src/features/outfits/outfits.css`

- [ ] Replace Outfits label-filter imports/props with advanced-filter equivalents and filter saved outfits explicitly with `OUTFIT_FILTER_GROUPS`:

  ```js
  const visibleOutfits = useMemo(
    () => outfits.filter((outfit) => matchesAdvancedFilter(
      outfit,
      advancedFilter,
      OUTFIT_FILTER_GROUPS,
    )),
    [advancedFilter, outfits],
  );
  ```

  Continue filtering by each outfit's saved `labelIds`; do not inspect garment colors or current garment labels.

- [ ] Render:

  ```jsx
  <UnifiedFilter
    groups={OUTFIT_FILTER_GROUPS}
    colors={colors}
    labels={labels}
    value={advancedFilter}
    onChange={onAdvancedFilterChange}
    loading={labelsLoading}
    error={labelsError}
    visibleCount={visibleOutfits.length}
    totalCount={outfits.length}
    resultNoun="outfits"
    context={context}
  />
  ```

  Passing colors is harmless and helps the component resolve retained state, but `groups` prevents Color section/chips/count/matching/clearing in Outfits.

- [ ] Add high-value Outfits tests with initial state containing Color + Summer + Rainy day:

  - Filter button badge counts two, not three.
  - Color section and Green chip are absent.
  - Outfit matching uses Summer AND Rainy day.
  - `Rensa alla` clears Season/Theme but returns `selectedColorIds: ["green"]` unchanged.
  - With only Color selected, all outfits remain visible and no `X av Y` advanced summary appears.
  - Navigating back to Wardrobe restores the Green chip and Color filtering.

- [ ] Preserve all current archived-item, load, wear, thumbnail, and inactive-fetch behavior.

- [ ] Run Outfits and cross-navigation tests:

  ```bash
  npx vitest run src/features/outfits/OutfitsView.test.jsx src/features/outfits/App.outfits.test.jsx src/features/outfits/App.outfitProvenance.test.jsx src/features/filters/App.filters.test.jsx
  ```

  Expected: view-scoped Color behavior passes without changing outfit label/save semantics.

- [ ] Commit the Outfits projection:

  ```bash
  git add src/features/outfits/OutfitsView.jsx src/features/outfits/OutfitsView.test.jsx src/features/outfits/outfits.css src/features/filters/App.filters.test.jsx
  git commit -m "feat: scope unified filters for saved outfits"
  ```

## Task 6: Remove the obsolete filter and complete responsive verification

**Files:**

- Delete: `src/features/labels/LabelFilter.jsx`
- Delete: `src/features/labels/LabelFilter.test.jsx`
- Modify: `src/features/labels/labels.css`
- Modify: `src/domain/labels.js`
- Modify: `src/domain/labels.test.js`
- Modify as defects require: files already listed in Tasks 1–5

- [ ] Confirm no runtime callsites remain before deleting:

  ```bash
  rg -n "LabelFilter|labelFilter|onLabelFilterChange|activeColor|color-filter|color-chip" src
  ```

  Expected before cleanup: only obsolete component/test/CSS exports remain. If a view/App callsite appears, migrate it before continuing.

- [ ] Delete `LabelFilter.jsx` and its test. Remove only `.label-filter-*` rules from `labels.css`; retain every `.label-picker-*`, `.theme-*`, and shared status rule used by ItemEditor. If `ItemEditorDialog` uses `.label-filter-status`, rename that one shared status class to `.label-status` in both JSX and CSS rather than deleting its styling.

- [ ] Remove the obsolete filter-only exports from `src/domain/labels.js`:

  - `emptyLabelFilter`;
  - `isLabelFilterActive`;
  - `sanitizeLabelFilter`;
  - `matchesLabelFilter`.

  Keep `SEASON_DEFINITIONS`, `labelsByKind`, `labelDisplayName`, and `sharedLabelIds`. Remove only the corresponding obsolete tests from `labels.test.js`; all replacement semantics belong in `filters.test.js`.

- [ ] Run the stale-name scan again:

  ```bash
  rg -n "LabelFilter|labelFilter|onLabelFilterChange|activeColor|color-filter|color-chip" src
  ```

  Expected: no matches. `LabelPicker`, `ThemeManager`, item `colors`, and `COLOR_FAMILIES` are intentionally still present.

- [ ] Run the complete application verification:

  ```bash
  npm test
  npm run build
  git diff --check
  ```

  Expected: all tests pass, Vite builds, only the existing bundle-size warning may remain, and whitespace check is clean.

- [ ] Manually verify desktop at the normal local URL:

  ```bash
  npm run dev
  ```

  Acceptance sequence:

  1. Category row remains above one Filter trigger.
  2. Open panel and confirm actual swatches plus Swedish names.
  3. Select two colors and confirm OR results.
  4. Add Summer and Rainy day and confirm AND across groups.
  5. Confirm removable chips, badge count, `X av Y`, Clear all, Escape, outside click, and focus return.
  6. Move Wardrobe -> Dress and confirm the shared selection.
  7. Confirm Dress's own category is still All and mannequin composition survives filter changes.
  8. Move to Outfits and confirm Color disappears without being cleared.
  9. Clear Outfits labels, return to Wardrobe, and confirm Color returns.

- [ ] Repeat on a real phone or narrow browser viewport:

  - bottom sheet reaches full width without page overflow;
  - content scrolls with a long theme list;
  - sticky `Visa X plagg/outfits` remains above safe area and bottom navigation;
  - selection count updates while the sheet remains open;
  - chips wrap and every touch target is at least 44px;
  - swatches for White/Cream/Beige and Black/Navy remain distinguishable because names are visible.

- [ ] Inspect final status and commit cleanup/fixes only:

  ```bash
  git status --short
  git diff --stat
  git diff --check
  ```

  ```bash
  git add src/domain/labels.js src/domain/labels.test.js src/features/labels src/features/filters src/features/wardrobe src/features/dress src/features/outfits src/App.jsx src/styles.css
  git commit -m "refactor: replace label filter with unified filters"
  ```

  Before committing, omit any path with no cleanup change and verify no unrelated concurrent changes are staged.

## Definition of done

- Exactly one advanced Filter control appears per applicable view.
- Garment type stays always visible and local to Wardrobe/Dress.
- Color is multi-select, uses actual swatches plus names, and is shared between Wardrobe/Dress.
- Season and Theme remain shared across Wardrobe/Dress/Outfits.
- OR-within and AND-across behavior is identical in pure domain tests and UI results.
- Outfits hides/ignores/preserves Color and its Clear all cannot clear Color.
- Active chips, applicable badge count, and visible/total count are accurate.
- Desktop panel and phone bottom sheet match the approved A direction.
- Dress filtering never changes mannequin composition, layers, provenance, or Undo.
- Failed label loading leaves Color usable and assignment saves protected.
- `LabelPicker`, `ThemeManager`, database/RLS, item assignments, outfit suggestions, outfit updates, and variations remain intact.
- Obsolete `LabelFilter`, local `activeColor`, and separate color-row code are gone.
- Complete Vitest suite and production build pass; phone and desktop acceptance are complete.
