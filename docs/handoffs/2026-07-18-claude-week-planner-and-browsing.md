# Claude Handover: Week Planner, Last-Worn Sorting, and Wardrobe Polish

## Objective

Implement the approved Wearit design in two ordered deliveries:

1. `docs/superpowers/plans/2026-07-18-wearit-week-planner-and-last-worn.md`
2. `docs/superpowers/plans/2026-07-18-wearit-gallery-and-mobile-polish.md`

The behavior contract is:

- `docs/superpowers/specs/2026-07-18-wearit-week-planner-sorting-and-gallery-design.md`

Plan 1 must finish before Plan 2 because last-worn metadata changes the Wardrobe card wrapper that the gallery-hover work extends.

## Repository and starting point

- Path: `/home/adam/Dev/Lab/Wearit`
- Branch: `main`
- Remote: `git@github.com:AdamGardelov/Wearit.git`
- Design commit: `9b40c57`
- Plan commit: `264c38d`
- At handover, `main` is 60 commits ahead of `upstream/main` and the working tree is clean.
- Frontend: React 19, Vite, plain CSS, Vitest/Testing Library.
- Backend: Supabase/PostgreSQL, RLS, pgTAP.

Open Claude from `/home/adam/Dev/Lab/Wearit`, not the stale `/home/adam/Dev/Lab/Wardrobe` path.

Adam wants direct development in this private v1 checkout. Do not create a worktree unless he explicitly changes that decision. Do not pull, rebase, reset, or rewrite the existing local history.

## Working style requested by Adam

This is a private app for Adam's wife. Optimize for a usable vertical slice and quick feedback.

- Strict TDD is not required.
- Implement each working slice, manually exercise it, then add the focused regression tests named in the plans.
- Keep privacy, RLS, owner-scoped foreign keys, and history correctness strong because the app stores personal data.
- Prefer small explicit modules over clever abstractions.
- Commit at each task boundary using the plan's commit messages.
- Never use `git add -A`; stage only the files owned by the active task.
- Do not modify or commit `.env.local`, real wardrobe photos, generated import packages, `.superpowers/`, or unrelated local files.

## Product decisions that are already final

### Week planner

- The planner is a reusable undated board, not a calendar.
- It always contains Monday through Friday only.
- One saved outfit can be assigned per weekday.
- The same outfit may be reused on multiple days.
- There are no dates, week numbers, previous/next week controls, Saturday, Sunday, or automatic reset.
- The plan remains until the owner changes it or confirms `Töm veckan`.
- Empty, planned, and Needs-attention day states are required.
- Planned outfits can be opened in the existing Dressing-room flow, replaced, or removed.
- Only the actual current weekday can show `Bär idag`.
- Saturday and Sunday show no wear action.
- Planning never creates history. `Bär idag` must use the existing `WearDialog` and exact saved-outfit provenance.
- After confirmation, the plan slot remains populated.
- `Vecka` is a new primary tab between Outfits and History.
- Mobile shows all five days as a vertical list; desktop shows five day cards.

### Last-worn sorting

- Wardrobe, Outfits, and the planner's outfit picker offer Standard, longest-since-used, and most-recently-used.
- Longest-since-used puts never-used entries first.
- Most-recently-used puts never-used entries last.
- Equal dates retain Standard order.
- Exact metadata appears only while a chronological sort is active.
- Standard mode remains usable if optional last-worn metadata fails to load.
- Outfit last-worn counts only wear events carrying that exact saved `outfit_id`; wearing the same loose items does not count.

### Gallery and mobile polish

- A Wardrobe card with a structured `view === "back"` image crossfades front to back on desktop fine-pointer hover and keyboard focus.
- It returns to front when hover/focus leaves.
- There is no flip animation, long press, timer, or runtime image generation.
- Touch/mobile stays front-only in the list; all views remain available in the existing item detail/lightbox.
- A failed back asset leaves the front image intact.
- Reduced-motion removes the transition.
- `Importera garderob` is always hidden below `900px` and visible from `900px` upward when the repository supports import.
- The import workflow itself does not change.

## Existing implementation anchors

- App state, exact outfit provenance, wear dialog, and primary navigation: `src/App.jsx`
- Wardrobe gallery/filtering: `src/features/wardrobe/WardrobeView.jsx`
- Global gallery, navigation, and admin-launch styles: `src/styles.css`
- Saved outfits and Needs-attention behavior: `src/features/outfits/OutfitsView.jsx`
- Outfit styles: `src/features/outfits/outfits.css`
- Unified Season/Theme filtering: `src/features/filters/UnifiedFilter.jsx`
- Wear confirmation: `src/features/history/WearDialog.jsx`
- Repository mapping/signing: `src/data/wardrobeRepository.js`
- Current outfit/wear schema: `supabase/migrations/202607170002_outfits_and_wear.sql`
- Outfit delete semantics: `supabase/migrations/202607180004_delete_outfit.sql`
- Structured product images: `supabase/migrations/202607180002_wardrobe_item_images.sql`
- Database test style: `supabase/tests/database/outfits_and_wear.test.sql`
- Repository outfit test style: `src/data/wardrobeRepository.outfits.test.js`
- Wardrobe component tests: `src/features/wardrobe/WardrobeView.test.jsx`
- App wear integration tests: `src/features/history/HistoryView.test.jsx`

Current facts to preserve:

- `listItemsWithLastWorn()` already attaches item `last_worn_at`.
- `listOutfits()` signs thumbnails and returns saved item order but has no outfit last-worn field yet.
- `requestWear()` keeps an `outfitId` only when the chosen items still exactly match the loaded saved outfit.
- Outfits containing archived items already expose `needs_attention` and disable load/wear actions.
- Item records already expose ordered structured `images` with `view`, `isPrimary`, and signed `url`.
- Wardrobe cards currently use `primaryImageUrl ?? cutoutUrl`.
- The admin launcher is outside primary navigation and currently visible at every viewport size.
- Applied migration numbering currently ends at `202607180004`; use the forward-only migration name specified by Plan 1.

## Implementation order

Follow the plan checkboxes in order. The intended task sequence is:

1. Confirm the clean baseline and run tests/build.
2. Add pure weekday and last-worn domain rules.
3. Add `weekly_plan_slots`, RLS, outfit-last-worn view, and pgTAP coverage.
4. Add repository planner operations and graceful last-worn metadata degradation.
5. Add the reusable sort control and integrate Wardrobe/Outfits.
6. Build the planner and outfit picker.
7. Wire the Vecka tab, exact wear action, and refresh behavior through App.
8. Run database, frontend, build, and responsive manual verification.
9. Only then execute the gallery/mobile-polish plan.

Do not collapse the database, repository, UI, and final verification into one giant commit. Stop and report if a required Supabase migration/test environment is unavailable; distinguish environment failure from code failure.

## Scope boundaries

Do not add:

- real calendar dates or multiple weeks;
- reminders, notifications, weather, AI, OpenAI APIs, or new secrets;
- wife-facing upload/import support;
- plan history or automatic completion;
- Saturday/Sunday slots;
- multiple outfits per day;
- outfit color derivation;
- new image processing or changes to the Codex import skill;
- unrelated refactors of App, filters, Dressing room, lightbox, or Supabase functions.

Do not edit existing applied migrations. Do not replace or weaken the existing exact-outfit wear rules.

## Required verification

Run when the environment permits:

```bash
npm run test:db
npm test
npm run build
```

Manually verify on phone and desktop widths:

- all five weekdays are visible and there are no dates/weekends;
- add, replace, open, and remove an outfit;
- `Töm veckan` confirms and does not delete saved outfits/history;
- a mutation failure preserves the confirmed plan;
- Needs-attention outfits cannot be newly selected or worn;
- only today's weekday shows `Bär idag`;
- confirming wear leaves the slot and refreshes item/outfit last-worn data and History;
- both chronological sort directions handle `Aldrig använd` correctly;
- metadata is hidden under Standard;
- a two-sided garment crossfades to the real back on desktop and stays front-only on touch;
- a front-only or failed-back garment never becomes blank;
- `Importera garderob` is absent below `900px` and present at or above it.

## Handoff back to Adam

When both plans are complete, report:

- commits created, in order;
- migration and schema changes;
- concise behavior summary;
- exact automated commands and results;
- any environment blockers;
- which phone/desktop interactions Adam still needs to confirm;
- known remaining defects, without claiming adjacent issues were fixed.

Do not process, import, regenerate, move, or delete any real clothing photos as part of this work.
