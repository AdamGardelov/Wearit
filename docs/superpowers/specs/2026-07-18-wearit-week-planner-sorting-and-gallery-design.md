# Wearit Week Planner, Last-Worn Sorting, and Gallery Design

Date: 2026-07-18
Status: Approved in conversation

## Context

Wearit already stores saved outfits, explicit wear events, item-level last-worn data, and structured product images with optional front and back views. The next product slice should make saved outfits useful for planning a normal workweek, make neglected or recently used clothes and outfits easy to find, and expose existing back images directly in the wardrobe gallery.

The planner is intentionally not a calendar. The owner wants one reusable Monday-to-Friday board, without dates or week numbers, which remains populated until she manually empties it. Planning never counts as wearing; history changes only after explicit confirmation.

This design also makes the desktop-only import workflow explicit by always hiding the `Importera garderob` launcher on phone-sized layouts.

## Goals

- Plan one saved outfit for each weekday from Monday through Friday.
- Keep the same undated plan until the owner changes or manually clears it.
- Register a planned outfit as worn only after an explicit `Bär idag` action.
- Sort clothes and saved outfits by last worn in both directions.
- Show exact last-worn information only while a last-worn sort is active.
- Show a garment's back image on desktop hover when one exists.
- Add the planner as a first-class responsive application section.
- Hide the import launcher below Wearit's desktop breakpoint.

## Non-goals

- Calendar dates, week numbers, previous or next week navigation, or multiple saved weeks.
- Automatic weekly reset.
- Saturday or Sunday planning.
- More than one outfit per weekday.
- One-off compositions created inside the planner.
- Automatic wear-history entries when a planned day arrives.
- Plan history, completion history, reminders, notifications, or weather integration.
- A mobile hover substitute such as long-pressing to reveal a back image.
- Changing the import workflow itself.

## Selected approach

Wearit stores up to five owner-scoped plan-slot rows in Supabase, one per ISO weekday `1` through `5`. Each row points to a saved outfit. An absent row represents an empty day.

This was selected over two alternatives:

- A single JSON week record is superficially smaller but weakens referential integrity, makes individual updates less explicit, and complicates outfit deletion.
- Date-based plan entries support a real calendar but contradict the desired reusable, undated workweek and add lifecycle behavior the owner does not need.

The existing wear-event model remains authoritative for actual use. The planner stores intent only.

## User-facing planner behavior

### Navigation and responsive layout

Add a `Vecka` primary navigation item between `Outfits` and `Historik`. The bottom navigation therefore contains five equal-width destinations.

On phones, the planner displays all five weekdays as a compact vertical list. The owner can see every filled day and every gap without swiping.

On desktop, the same data expands to five day cards in one row. Each card uses the saved outfit thumbnail and name. Responsive presentation changes only the layout, not the available operations.

The page heading is `Min vecka`. Supporting text explains that the plan remains until it is manually emptied. There are no dates, week numbers, or calendar navigation controls.

### Day slots

Each weekday slot has one of three states:

- **Empty:** shows `Välj outfit`.
- **Planned:** shows the saved outfit thumbnail and name, with actions to open, replace, or remove it from that day.
- **Needs attention:** shows the outfit and `Behöver åtgärdas` when one or more constituent items have become unavailable. It can be opened, replaced, or removed, but it cannot be registered as worn.

Selecting an empty or replace action opens an outfit picker. The picker uses the existing saved-outfit presentation and reusable Season/Theme filter component. It uses the shared Season/Theme selections already applicable to Outfits; Color remains inapplicable. Filtering the picker never hides or removes outfits already assigned to other weekdays.

Outfits needing attention remain visible in the picker with a disabled state and explanation, rather than disappearing without context. They cannot be newly assigned.

The picker has its own sort choice with the same Standard, longest-since-used, and most-recently-used semantics described below. Reusing the same saved outfit on multiple weekdays is allowed.

### Current day and wear confirmation

When the local current day is Monday through Friday, the corresponding slot receives a restrained current-day treatment. Only that slot can show `Bär idag`, and only when it contains a valid saved outfit.

`Bär idag` opens the existing wear-confirmation flow for the exact saved outfit. Planning alone never creates a wear event. Confirmation records the outfit and all of its current active items through the existing wear operation, refreshes History and last-worn data, and leaves the planned slot in place.

On Saturday and Sunday no slot is marked as today and no `Bär idag` action appears. Retroactive wear registration remains the responsibility of the existing history/wear flow, not the planner.

### Clearing

Removing one weekday deletes only that slot and does not require a destructive confirmation dialog. The UI keeps the existing plan visible until Supabase confirms the deletion; on failure it shows an inline retryable error.

`Töm veckan` appears after the five slots. It requires explicit confirmation stating that all planned weekdays will be emptied and that saved outfits and wear history are unaffected. The visible plan changes only after the database confirms the clear operation.

There is no automatic reset on Monday or at any other time.

## Data model

Add a forward-only Supabase migration. Do not edit an applied migration.

### `weekly_plan_slots`

- `owner_id uuid not null`, referencing the owner profile with cascade delete.
- `weekday smallint not null`, constrained to ISO weekday values `1` through `5`.
- `outfit_id uuid not null`.
- `created_at timestamptz not null default now()`.
- `updated_at timestamptz not null default now()`.
- Primary key `(owner_id, weekday)`, enforcing at most one outfit per weekday and at most five slots per owner.
- Composite owner-scoped foreign key `(owner_id, outfit_id)` to the saved outfit, with cascade delete. The migration adds or reuses the necessary unique owner/id constraint on `outfits`.

The composite foreign key prevents an owner from assigning another owner's outfit even if an application or policy bug submits its UUID. Deleting a saved outfit automatically empties every weekday that points to it. Editing an outfit does not rewrite the plan row, so the plan automatically reflects the current name, thumbnail, labels, and item composition.

Enable RLS. Authenticated owners may select, insert, update, and delete only their own slot rows; anonymous access is denied. Database constraints remain authoritative in addition to RLS.

### Outfit last-worn view

Add `outfit_last_worn` as a `security_invoker` view containing:

- `owner_id`.
- `outfit_id`.
- `max(wear_events.worn_at) as last_worn_at`.

Only events with a non-null `outfit_id` participate. Wearing the same garments as a loose composition does not count as wearing the saved outfit. Wearit's existing exact-outfit behavior remains authoritative: if a loaded outfit is changed before confirmation, it is recorded as items rather than falsely updating that saved outfit.

Grant authenticated owners read access through the same owner-scoped base-table protections as the existing item last-worn view.

## Repository and application boundaries

The repository exposes planner operations in product terms:

- `listWeeklyPlan()` returns the five possible weekday states with signed current outfit thumbnails.
- `setWeeklyPlanSlot({ weekday, outfitId })` creates or replaces one slot.
- `clearWeeklyPlanSlot(weekday)` removes one slot.
- `clearWeeklyPlan()` removes all five owner slots.

Components do not call Supabase directly. The repository validates weekday values before sending them and converts rows to the application's existing camelCase shapes.

`listOutfits()` gains `last_worn_at` through the new view while preserving its existing default `updated_at desc` ordering. Existing callers may ignore the new field. The planner, Outfits view, and outfit picker share one pure last-worn comparator instead of reimplementing null and direction rules.

Add a focused `WeekPlanner` feature boundary. It owns planner loading and mutation state, current-day presentation, slot actions, and the outfit picker. `App` owns only section navigation and the bridge to the existing wear-confirmation flow. A successful planner wear refreshes the existing item snapshot, Outfits data, and History data through the same application-level refresh path used elsewhere.

## Last-worn sorting

Add a compact `Sortera` control beside the existing Filter control in Wardrobe and Outfits. Sort state is local and independent per page and resets on a full reload.

The available orders are:

- **Standard:** the current view order. Wardrobe preserves its existing repository/gallery order; Outfits remains ordered by most recently updated.
- **Längst sedan använd:** entries with no wear date first, then dated entries from oldest to newest.
- **Senast använd:** dated entries from newest to oldest, then entries with no wear date.

Use a stable tie-breaker based on each view's Standard order so equal or absent dates do not make cards jump unpredictably.

When either last-worn order is active, each card shows a subdued metadata line such as `Senast använd 14 juli` or `Aldrig använd`. The line is absent in Standard order, preserving the clean default gallery. The result count and existing Category/Color/Season/Theme filters continue to apply before sorting; sorting never changes filter state.

Items use the existing `wardrobe_item_last_worn` view. Outfits use the new `outfit_last_worn` view.

## Wardrobe back-image interaction

This behavior applies only to garment cards in the Wardrobe gallery.

For each item, derive an optional back image from its existing structured `images` collection where `view === "back"`. The existing primary image remains the front/fallback image.

When a back image exists:

- Render front and back in the same fixed gallery bounds so the card never changes size.
- On devices with a fine pointer and real hover support, crossfade from front to back when the card is hovered and restore the front when hover ends.
- Show the same back state on keyboard `focus-visible`, preserving access to the interaction without a mouse.
- Keep the existing restrained scale treatment without adding a card-flip or 3D animation.
- Disable the fade transition under `prefers-reduced-motion`.
- If the back asset fails to load, leave the front visible and treat the card as front-only.

On touch/mobile gallery layouts, always show the front image. The existing item detail/lightbox remains the way to inspect all views on those devices. Items without a back image retain their current markup and visual behavior.

## Desktop-only import launcher

The `Importera garderob` launcher is hidden by default and becomes visible only at the existing desktop breakpoint, `min-width: 900px`.

This rule applies in portrait and landscape: any viewport below `900px` hides the launcher. It changes only launcher visibility. It does not modify bundle formats, permissions, import behavior, or imported data.

## Loading, failure, and race behavior

- Initial planner loading preserves the page shell and shows a bounded loading state for the slots.
- A failed initial load shows a retry action rather than five misleading empty days.
- Slot mutations disable only the affected action while in flight and preserve confirmed server state until success.
- A failed replace, remove, or clear shows an inline error and retry without silently changing the plan.
- If an outfit is deleted concurrently, reload the plan; the database cascade leaves the affected slot empty.
- If a planned outfit becomes invalid because an item is archived, show Needs attention and disable `Bär idag` until the outfit is repaired or the slot is replaced.
- A failed last-worn lookup preserves Standard browsing rather than rendering an incorrect chronological order. Surface a non-destructive error when the owner requested last-worn sorting.
- Sorting and hover-image failures never mutate wardrobe, outfit, planner, or history data.

## Accessibility and responsive details

- Five bottom-navigation buttons retain at least 44 CSS pixel touch targets and do not create horizontal page overflow.
- Weekday names are full accessible labels even if the visual phone layout abbreviates them.
- Current day uses text/state in addition to color.
- Planner cards and picker actions have explicit accessible names containing the weekday and outfit.
- Confirmation focus returns to the triggering action.
- Loading and mutation errors use an announced status region without stealing focus.
- Sort controls expose the active order programmatically.
- Last-worn metadata is real text, not hover-only content.
- Gallery hover is an enhancement; opening an item remains unchanged and all product images remain available in the detail view.

## Compatibility

- Existing owners begin with an empty planner because no rows are backfilled.
- Existing saved outfits, thumbnails, labels, item placement, archive semantics, and wear history remain unchanged.
- Deleting an outfit clears its plan slots but continues to follow the existing outfit-delete rules for historical wear events.
- Planning the same outfit on multiple weekdays is valid.
- Existing item last-worn behavior remains unchanged.
- Existing structured front/back images require no migration or reprocessing.
- Import packages and the Codex image-processing workflow remain unchanged.
- The feature adds no AI, OpenAI API, calendar API, notification service, weather API, or deployment secret.

## Verification strategy

Wearit continues to use feature-first development rather than strict TDD. Add focused regression coverage after each vertical slice works.

### Database and repository checks

- RLS prevents cross-owner slot reads and writes.
- The composite foreign key rejects another owner's outfit.
- Weekday constraints reject `0`, `6`, `7`, and invalid values.
- The primary key permits only one outfit per owner and weekday.
- Set, replace, clear-one, and clear-all operations behave idempotently.
- Outfit deletion cascades to every referencing plan slot without deleting other slots.
- `outfit_last_worn` returns the newest exact outfit wear event and ignores loose item-only events.
- Existing owners migrate to an empty planner without changing other data.

### Component and integration checks

- The planner renders five weekdays and no weekend, dates, or week navigation.
- Phone shows a five-row list; desktop shows five cards.
- Empty, planned, and Needs-attention states expose the correct actions.
- The outfit picker applies reusable Season/Theme filters and last-worn sorting without mutating assigned slots.
- Only the actual Monday-to-Friday slot exposes `Bär idag`; weekends expose none.
- Wear confirmation records history, refreshes last-worn data, and leaves the plan slot intact.
- Removing one slot does not affect the others.
- `Töm veckan` requires confirmation and preserves the plan on failure.
- Wardrobe and Outfits implement all three stable sort orders, including correct placement of `Aldrig använd`.
- Last-worn metadata appears only for a last-worn sort.
- Wardrobe cards crossfade to a valid back image on fine-pointer hover and keyboard focus, remain front-only without one, and preserve front on back-image failure.
- Touch layouts stay front-only in the gallery.
- `Importera garderob` is absent below `900px` and visible at or above `900px`.

Run the existing test suite and production build. Manually verify the five-item bottom navigation, planner layout, outfit picker, current-day action, sorting controls, hover/focus image behavior, reduced-motion behavior, and import-launcher breakpoint in real mobile and desktop browsers.
