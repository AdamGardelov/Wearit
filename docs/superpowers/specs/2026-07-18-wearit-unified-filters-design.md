# Wearit Unified Filters Design

Date: 2026-07-18  
Status: Approved in conversation

## Context

Wearit already has an always-visible garment-type row and a committed single-select color filter. The approved season/theme design adds two more filtering dimensions. Rendering Color, Season, and Theme as separate rows would push clothes down the page, create a cluttered phone experience, and make the active result difficult to understand.

This design unifies the advanced filters while preserving garment type as the fastest browsing control. It supplements `2026-07-18-wearit-season-theme-labels-design.md`: that document remains authoritative for label persistence and outfit assignment, while this document is authoritative for filter state and presentation.

## Goals

- Keep garment type immediately accessible in Wardrobe and Dress.
- Put Color, Season, and Theme in one coherent responsive filter control.
- Support multiple colors as well as multiple seasons and themes.
- Make every active restriction visible without reopening the filter.
- Share relevant advanced filters across application sections during the current session.
- Preserve the current color-family classification and the planned season/theme database model.
- Remain equally usable on phone and desktop.

## Non-goals

- Persisting filters across a page reload.
- Adding color assignments to saved outfits.
- Deriving an outfit color dynamically from its garments.
- Moving theme creation, rename, or deletion into the filter panel.
- Replacing garment categories with filter groups.
- Adding new database tables or columns beyond the season/theme migration.

## Selected approach

Wearit uses one `Filter` trigger for Color, Season, and Theme. Garment type remains an always-visible segmented row above it.

The trigger shows a badge containing the number of applicable active selections. Active selections appear as removable chips beside or below the trigger. A `Rensa alla` action clears every applicable advanced filter.

On desktop, the trigger opens a bounded panel anchored below it. Filter selections update results immediately and the panel stays open until the owner closes it, presses Escape, or clicks outside.

On phone, the trigger opens a full-width bottom sheet with safe-area padding and scrollable contents. Selections update the result count immediately. A sticky `Visa X plagg` or `Visa X outfits` button closes the sheet without requiring a separate Apply transaction.

Two alternatives were rejected:

- Always-visible filter groups are easy to discover but consume too much vertical space, especially when the theme list grows.
- Separate dropdowns for Color, Season, and Theme work on wide screens but become a horizontal-scroll control bar on phones and fragment the active-filter experience.

## Filter groups and matching

Garment type remains single-select. `Alla` is the default. Type state is local to its view: selecting Tops in Wardrobe does not restrict Dress later.

Color, Season, and Theme are multi-select. Matching follows two consistent rules:

- OR within a group.
- AND between non-empty groups.

Examples:

- Black + White matches clothes classified as Black or White.
- Summer + Winter matches entries assigned to either season.
- Black + White + Summer + Rainy day means `(Black OR White) AND Summer AND Rainy day`.
- Garment type combines with advanced groups using AND.

An empty advanced filter matches every entry. Existing unlabeled clothes and outfits therefore remain visible under All and disappear only when an applicable label group is selected.

## View scope

### Wardrobe

Wardrobe shows the local garment-type row and all three advanced groups: Color, Season, and Theme. All predicates combine against active wardrobe items.

### Dress

Dress shows its own local garment-type row and the same shared Color, Season, and Theme selections. Advanced filters narrow only the garment tray. They never remove a selected garment from the mannequin, change layer order, or add an undo step.

### Outfits

Outfits shows Season and Theme only, filtering by each outfit's explicitly saved label IDs. Color is neither shown nor applied because outfits do not store a color classification and deriving one from contained garments would obscure manual outfit intent.

A Color selection remains in shared session state while Outfits is open. Outfits excludes it from visible chips, badge count, result count, and Clear all. Returning to Wardrobe or Dress restores the Color selection. Season and Theme remain visible and active across all three views.

## Color presentation

Every Color option displays both:

- the actual color-family swatch; and
- its localized text name.

The same swatch-and-name combination appears in the active Color chip. Text remains mandatory because similar families such as White, Cream, Beige, Navy, and Black cannot be identified reliably from a small circle alone. Selected state also includes a checkmark and border treatment, so it never relies on color alone.

The existing color-family IDs and `itemColorFamilies` classification remain authoritative. Available colors are derived from the complete active wardrobe rather than the currently filtered result, preventing options from disappearing while filters are selected.

## Shared state

`App` owns one advanced filter state for the current repository/session:

```js
{
  selectedColorIds: [],
  selectedSeasonIds: [],
  selectedThemeIds: [],
}
```

Color IDs are the stable string IDs from the existing color domain. Season and Theme IDs are owner-scoped label UUIDs from Supabase. Display names and swatch values are presentation data and never act as identifiers.

The state resets to empty when the application reloads or the injected/base repository changes. A repository change cannot carry label IDs or color selections into another owner context.

Pure domain functions provide:

- empty filter creation;
- applicable active-selection counts;
- per-group sanitization;
- OR-within/AND-between item matching;
- view-scoped projection for chips and Clear all.

Sanitization removes duplicate, unknown, deleted, and wrong-kind IDs. It uses the complete available Color/Season/Theme collections, never the currently filtered result.

## Component boundaries

### `UnifiedFilter`

One reusable controlled component replaces the planned standalone `LabelFilter`. Its conceptual API is:

```jsx
<UnifiedFilter
  groups={["color", "season", "theme"]}
  colors={colors}
  labels={labels}
  value={advancedFilter}
  onChange={onAdvancedFilterChange}
  loading={labelsLoading}
  error={labelsError}
  visibleCount={visibleCount}
  totalCount={totalCount}
  resultNoun="plagg"
/>
```

`groups` defines which sections, chips, badge selections, and Clear all behavior apply in the current view. Wardrobe and Dress pass all three groups. Outfits passes only Season and Theme.

The component owns only presentation state such as panel open/closed. It does not fetch data, classify colors, mutate themes, or persist selections.

### Views

Wardrobe and Dress retain their own category state. Each view applies its category predicate and the shared advanced-filter predicate together.

Outfits applies only saved outfit label IDs. It does not inspect the current labels or colors of garments inside an outfit.

### Item and outfit assignment controls

The planned `LabelPicker` and `ThemeManager` remain separate from `UnifiedFilter`. Item settings continue to assign seasons/themes and manage theme records. Outfit saving continues to edit explicit outfit labels. Filtering never mutates assignments.

## Counts and empty states

With no applicable advanced selection, the normal total count remains. When filtered, the view reports visible relative to total, for example `4 av 10 plagg`.

The Filter badge counts individual applicable selections, not non-empty groups. Black + White + Summer therefore shows `3` in Wardrobe/Dress. The same state shows `1` in Outfits because Color is not applicable there.

If no entry matches, the existing content area shows a clear empty result and keeps the category row, Filter trigger, chips, and Clear all available. The owner must never be trapped in an empty result without an obvious reset.

## Theme management and deletion

The filter panel lists existing owner themes but does not create, rename, or delete them. Theme management remains in item settings as approved in the season/theme design.

When a theme is deleted, its assignment rows cascade in Supabase. `App` removes its ID from shared filter state, so its chip and selection disappear immediately. Clothes, outfits, thumbnails, mannequin composition, and wear history remain intact.

## Loading and error behavior

Color is local domain data and remains usable when label loading fails. In that state:

- the Color section continues to work in Wardrobe and Dress;
- Season and Theme show an inline load error instead of empty choices;
- the normal wardrobe/outfit shell and content remain visible;
- label assignment saves stay disabled, preventing invisible assignments from being overwritten;
- retrying/reloading labels does not clear valid Color selections.

If a previously available color family disappears because the complete active wardrobe changed, its ID is removed from shared filter state. This does not archive, restore, or otherwise mutate any item.

## Responsive and accessibility behavior

- Garment-type rows remain horizontally scrollable where necessary.
- Active chips wrap onto additional lines and never create page-level horizontal overflow.
- Phone bottom-sheet actions remain above browser safe areas and the bottom navigation.
- The sheet contents scroll independently when themes exceed the viewport.
- All interactive targets are at least 44 CSS pixels on phone.
- Escape closes the desktop panel; outside click closes it without clearing selections.
- The phone close button and `Visa X` button both preserve current selections.
- Every group has a programmatic label, every toggle exposes selected state, and every swatch has a text name.
- Focus returns to the Filter trigger after close.

## Compatibility

- Existing color-filter behavior from commit `70c7261` is retained but expanded from single-select/local to multi-select/shared between Wardrobe and Dress.
- Existing category behavior remains local and always visible.
- The season/theme persistence design remains unchanged.
- Existing descriptive item tags remain unrelated to filtering.
- Import bundles remain unchanged.
- The feature adds no AI, weather API, secret, or deployment variable.

## Verification strategy

Feature development remains feature-first with focused regression coverage after each working slice.

Domain tests cover:

- multiple colors using OR;
- multiple seasons and themes using OR within their groups;
- AND across Color, Season, and Theme;
- local category AND advanced filters;
- applicable selection projection and counts;
- sanitization of duplicate, deleted, unknown, and wrong-kind values.

Component/integration tests cover:

- one Filter trigger instead of a separate color row;
- swatch plus name for every Color option and active Color chip;
- selected chips, individual removal, and view-scoped Clear all;
- category state remaining local to Wardrobe and Dress;
- Color/Season/Theme remaining shared between Wardrobe and Dress;
- Outfits hiding and ignoring Color while retaining it for later navigation;
- Outfits badge/count excluding Color;
- desktop live updates and panel close/focus behavior;
- phone count updates and `Visa X` close behavior;
- label-load failure leaving Color usable;
- Dress filters never changing the mannequin composition;
- deleted themes disappearing safely from the active filter.

Manual acceptance verifies the real panel on desktop and bottom sheet on a phone, including long theme lists, wrapping chips, safe-area spacing, color-family legibility, and empty results.

## Implementation-plan impact

The existing season/theme implementation plan must be revised before Claude starts it:

- Replace `LabelFilter` with `UnifiedFilter`.
- Extend the shared state with `selectedColorIds`.
- Move existing Color state and filtering out of `WardrobeView` into the shared advanced-filter boundary.
- Change Color from single-select to multi-select.
- Pass all groups to Wardrobe/Dress and only Season/Theme to Outfits.
- Extend domain tests and current color regressions with view-scoped semantics.
- Preserve `LabelPicker`, `ThemeManager`, database migration, RLS, and label-assignment tasks.
