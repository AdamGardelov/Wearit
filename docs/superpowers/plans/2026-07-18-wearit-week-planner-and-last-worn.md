# Wearit Week Planner and Last-Worn Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent undated Monday-to-Friday outfit planner and stable last-worn sorting for Wardrobe, Outfits, and the planner's outfit picker.

**Architecture:** Store at most five owner-scoped weekday-to-outfit rows in Supabase and expose them through focused repository methods. Add an owner-safe outfit last-worn view and one pure sorting domain shared by all consumers. A new `WeekPlanner` section owns plan mutations and delegates actual wear registration to App's existing `WearDialog` flow.

**Tech Stack:** React 19, Vite, Vitest/Testing Library, plain CSS, Supabase/PostgreSQL with RLS and pgTAP.

---

## Working constraints

- Work directly in `/home/adam/Dev/Lab/Wearit`; this private v1 project intentionally does not require a worktree.
- Read `docs/superpowers/specs/2026-07-18-wearit-week-planner-sorting-and-gallery-design.md` before editing. It is authoritative.
- Implement feature-first and add the focused tests in each task after the working slice. Strict TDD is not required.
- Do not use `git add -A`; `tmp/` is user-owned and must remain untouched.
- Add one forward-only migration. Never edit an applied migration.
- Keep planning separate from wear history: only the existing `recordWear` flow writes wear events.
- This plan must finish before `2026-07-18-wearit-gallery-and-mobile-polish.md`, because that plan extends the Wardrobe card markup changed here.

## Public shapes

```js
// Repository result: always five entries, ordered Monday-Friday.
{
  weekday: 1, // ISO weekday 1..5
  outfitId: "outfit-uuid" | null,
  outfit: { id: "outfit-uuid", name: "Office", items: [], last_worn_at: null } | null,
}

// Sort values used by every page and picker.
"standard" | "oldest" | "newest"
```

## Task 0: Protect the baseline

**Files:** None.

- [ ] Inspect the current checkout:

  ```bash
  cd /home/adam/Dev/Lab/Wearit
  git status --short --branch
  git log -3 --oneline
  ```

  Expected: `main` includes design commit `9b40c57`; only known user-owned files such as `tmp/` may be untracked.

- [ ] Run the baseline:

  ```bash
  npm test
  npm run build
  ```

  Expected: both commands exit 0. Record any pre-existing failure before editing.

## Task 1: Add pure weekday and last-worn rules

**Files:**

- Create: `src/domain/weeklyPlan.js`
- Create: `src/domain/weeklyPlan.test.js`
- Create: `src/domain/lastWorn.js`
- Create: `src/domain/lastWorn.test.js`

- [ ] Create the weekday domain:

  ```js
  export const WEEKDAYS = Object.freeze([
    { value: 1, label: "Måndag", shortLabel: "Mån" },
    { value: 2, label: "Tisdag", shortLabel: "Tis" },
    { value: 3, label: "Onsdag", shortLabel: "Ons" },
    { value: 4, label: "Torsdag", shortLabel: "Tor" },
    { value: 5, label: "Fredag", shortLabel: "Fre" },
  ]);

  export function validWeekday(value) {
    return Number.isInteger(value) && value >= 1 && value <= 5;
  }

  export function currentWeekday(date = new Date()) {
    const value = date.getDay();
    return validWeekday(value) ? value : null;
  }

  export function emptyWeek() {
    return WEEKDAYS.map(({ value }) => ({ weekday: value, outfitId: null, outfit: null }));
  }
  ```

- [ ] Create the stable last-worn domain:

  ```js
  export const LAST_WORN_SORT = Object.freeze({
    STANDARD: "standard",
    OLDEST: "oldest",
    NEWEST: "newest",
  });

  function wornTime(entry) {
    if (!entry?.last_worn_at) return null;
    const value = Date.parse(entry.last_worn_at);
    return Number.isFinite(value) ? value : null;
  }

  export function sortByLastWorn(entries, order) {
    if (order === LAST_WORN_SORT.STANDARD) return [...entries];
    return entries
      .map((entry, index) => ({ entry, index, time: wornTime(entry) }))
      .sort((left, right) => {
        if (left.time === null && right.time === null) return left.index - right.index;
        if (left.time === null) return order === LAST_WORN_SORT.OLDEST ? -1 : 1;
        if (right.time === null) return order === LAST_WORN_SORT.OLDEST ? 1 : -1;
        const byTime = order === LAST_WORN_SORT.OLDEST
          ? left.time - right.time
          : right.time - left.time;
        return byTime || left.index - right.index;
      })
      .map(({ entry }) => entry);
  }

  export function lastWornText(value, locale = "sv-SE") {
    if (!value || !Number.isFinite(Date.parse(value))) return "Aldrig använd";
    return `Senast använd ${new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
    }).format(new Date(value))}`;
  }
  ```

- [ ] Add Vitest cases proving weekday validation, weekend-to-null mapping, five empty slots, null placement in both sort directions, stable ties, invalid dates as never worn, and Swedish metadata text.

- [ ] Run and commit:

  ```bash
  npx vitest run src/domain/weeklyPlan.test.js src/domain/lastWorn.test.js
  git add src/domain/weeklyPlan.js src/domain/weeklyPlan.test.js src/domain/lastWorn.js src/domain/lastWorn.test.js
  git commit -m "feat: add weekly plan and last-worn rules"
  ```

## Task 2: Add planner persistence and outfit last-worn data

**Files:**

- Create: `supabase/migrations/202607180005_weekly_planner.sql`
- Create: `supabase/tests/database/weekly_planner.test.sql`

- [ ] Add the owner-scoped table and security-invoker view:

  ```sql
  create table public.weekly_plan_slots (
    owner_id uuid not null references public.profiles(id) on delete cascade,
    weekday smallint not null check (weekday between 1 and 5),
    outfit_id uuid not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (owner_id, weekday),
    foreign key (owner_id, outfit_id)
      references public.outfits(owner_id, id) on delete cascade
  );

  alter table public.weekly_plan_slots enable row level security;

  create policy owners_select_weekly_plan on public.weekly_plan_slots
    for select using (auth.uid() = owner_id);
  create policy owners_insert_weekly_plan on public.weekly_plan_slots
    for insert with check (auth.uid() = owner_id);
  create policy owners_update_weekly_plan on public.weekly_plan_slots
    for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
  create policy owners_delete_weekly_plan on public.weekly_plan_slots
    for delete using (auth.uid() = owner_id);

  revoke all on table public.weekly_plan_slots from anon, authenticated;
  grant select, insert, delete on table public.weekly_plan_slots to authenticated;
  grant update (outfit_id, updated_at) on table public.weekly_plan_slots to authenticated;

  create view public.outfit_last_worn
  with (security_invoker = true)
  as
  select owner_id, outfit_id, max(worn_at) as last_worn_at
  from public.wear_events
  where outfit_id is not null
  group by owner_id, outfit_id;

  revoke all privileges on table public.outfit_last_worn from anon, authenticated;
  grant select on table public.outfit_last_worn to authenticated;
  ```

- [ ] Add pgTAP fixtures for two owners and three outfits. Assert:

  ```sql
  select is(pg_temp.table_privileges('anon', 'public.weekly_plan_slots'), '{}'::text[], 'anon has no planner privileges');
  select is((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.outfit_last_worn'::regclass), true, 'outfit last-worn is security invoker');
  select lives_ok($sql$insert into public.weekly_plan_slots(owner_id, weekday, outfit_id) values (auth.uid(), 1, '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid)$sql$, 'owner plans Monday');
  select is(pg_temp.sqlstate_for($sql$insert into public.weekly_plan_slots(owner_id, weekday, outfit_id) values (auth.uid(), 6, '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid)$sql$), '23514', 'weekends are rejected');
  select is(pg_temp.sqlstate_for($sql$insert into public.weekly_plan_slots(owner_id, weekday, outfit_id) values (auth.uid(), 2, '3ddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid)$sql$), '23503', 'foreign outfit is rejected structurally');
  ```

  Also prove one slot per weekday, owner isolation, update/clear, outfit-delete cascade, exact outfit wear max timestamp, item-only wear exclusion, and zero existing planner rows after migration.

- [ ] Run and commit:

  ```bash
  npm run test:db
  git add supabase/migrations/202607180005_weekly_planner.sql supabase/tests/database/weekly_planner.test.sql
  git commit -m "feat: persist weekly outfit plans"
  ```

## Task 3: Expose planner and outfit last-worn repository operations

**Files:**

- Modify: `src/data/wardrobeRepository.js:284-303,457-473,751-770`
- Create: `src/data/wardrobeRepository.planner.test.js`
- Modify: `src/data/wardrobeRepository.outfits.test.js:46-64`

- [ ] Extend `listOutfits()` so signing remains in one place and every outfit receives `last_worn_at`:

  ```js
  async function listOutfits() {
    const [outfits, lastWornRows] = await Promise.all([
      dataOrThrow(await client.from("outfits").select(OUTFIT_SELECT)
        .order("updated_at", { ascending: false })) || [],
      dataOrThrow(await client.from("outfit_last_worn")
        .select("outfit_id, last_worn_at")) || [],
    ]);
    const lastWornByOutfit = new Map(
      lastWornRows.map((row) => [row.outfit_id, row.last_worn_at]),
    );
    return signOutfits(outfits.map((outfit) => ({
      ...outfit,
      last_worn_at: lastWornByOutfit.get(outfit.id) ?? null,
    })));
  }
  ```
- [ ] Wrap only the optional `outfit_last_worn` query in `try/catch`; on failure keep the loaded outfits, attach `last_worn_at: null` and `last_worn_unavailable: true`, and keep Standard browsing usable. Apply the same rule to `listItemsWithLastWorn()` so a metadata outage does not empty Wardrobe.


- [ ] Add repository planner operations and export all four:

  ```js
  function requireWeekday(weekday) {
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 5) {
      throw new Error("Weekday must be an integer from 1 to 5.");
    }
  }

  async function listWeeklyPlan() {
    const [rows, outfits] = await Promise.all([
      dataOrThrow(await client.from("weekly_plan_slots")
        .select("weekday, outfit_id").order("weekday", { ascending: true })) || [],
      listOutfits(),
    ]);
    const rowByDay = new Map(rows.map((row) => [row.weekday, row]));
    const outfitById = new Map(outfits.map((outfit) => [outfit.id, outfit]));
    return [1, 2, 3, 4, 5].map((weekday) => {
      const row = rowByDay.get(weekday);
      const outfit = row ? outfitById.get(row.outfit_id) ?? null : null;
      return { weekday, outfitId: outfit?.id ?? null, outfit };
    });
  }

  async function setWeeklyPlanSlot({ weekday, outfitId }) {
    requireWeekday(weekday);
    const ownerId = await authenticatedOwnerId();
    return dataOrThrow(await client.from("weekly_plan_slots").upsert({
      owner_id: ownerId,
      weekday,
      outfit_id: outfitId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "owner_id,weekday" }).select("weekday, outfit_id").single());
  }

  async function clearWeeklyPlanSlot(weekday) {
    requireWeekday(weekday);
    const ownerId = await authenticatedOwnerId();
    return dataOrThrow(await client.from("weekly_plan_slots").delete()
      .eq("owner_id", ownerId).eq("weekday", weekday));
  }

  async function clearWeeklyPlan() {
    const ownerId = await authenticatedOwnerId();
    return dataOrThrow(await client.from("weekly_plan_slots").delete()
      .eq("owner_id", ownerId));
  }
  ```

- [ ] Add repository tests for signed plan outfits, five ordered slots, last-worn joins, graceful item/outfit last-worn failure flags, upsert conflict key, owner-scoped deletes, invalid weekdays rejected before I/O, and database errors propagated.

- [ ] Run and commit:

  ```bash
  npx vitest run src/data/wardrobeRepository.outfits.test.js src/data/wardrobeRepository.planner.test.js
  git add src/data/wardrobeRepository.js src/data/wardrobeRepository.outfits.test.js src/data/wardrobeRepository.planner.test.js
  git commit -m "feat: expose weekly planner repository"
  ```

## Task 4: Add reusable sort controls and integrate both lists

**Files:**

- Create: `src/features/sorting/LastWornSort.jsx`
- Create: `src/features/sorting/LastWornSort.test.jsx`
- Create: `src/features/sorting/sorting.css`
- Modify: `src/features/wardrobe/WardrobeView.jsx:1-36,135-142,216-281`
- Modify: `src/features/wardrobe/WardrobeView.test.jsx`
- Modify: `src/features/outfits/OutfitsView.jsx:1-10,31-61,81-200`
- Modify: `src/features/outfits/OutfitsView.test.jsx:250-393`
- Modify: `src/features/outfits/outfits.css:9-25`
- Modify: `src/styles.css:147-187`

- [ ] Create the controlled sort component and metadata element:

  ```jsx
  import { LAST_WORN_SORT, lastWornText } from "../../domain/lastWorn.js";
  import "./sorting.css";

  export function LastWornSort({ value, onChange, context }) {
    return (
      <label className="last-worn-sort">
        <span>Sortera</span>
        <select aria-label={`Sortera ${context}`} value={value}
          onChange={(event) => onChange(event.target.value)}>
          <option value={LAST_WORN_SORT.STANDARD}>Standard</option>
          <option value={LAST_WORN_SORT.OLDEST}>Längst sedan använd</option>
          <option value={LAST_WORN_SORT.NEWEST}>Senast använd</option>
        </select>
      </label>
    );
  }

  export function LastWornMeta({ value }) {
    return <p className="last-worn-meta">{lastWornText(value)}</p>;
  }
  ```

- [ ] In each view, keep local `sortOrder`, filter first, then call `sortByLastWorn`. Render `LastWornMeta` only when `sortOrder !== "standard"`. In Wardrobe wrap each existing button plus metadata in `.gallery-entry`; keep the focus ref on the button. In Outfits place metadata in `.outfit-card-copy` below the item count.

  ```js
  const [sortOrder, setSortOrder] = useState(LAST_WORN_SORT.STANDARD);
  const visibleOutfits = useMemo(() => sortByLastWorn(
    outfits.filter((outfit) => matchesAdvancedFilter(
      outfit, advancedFilter, OUTFIT_FILTER_GROUPS,
    )),
    sortOrder,
  ), [outfits, advancedFilter, sortOrder]);
  ```
- [ ] If chronological sorting is selected while any entry has `last_worn_unavailable`, keep Standard order and show `Kunde inte ladda senast använd. Försök igen.` as a non-destructive alert.


- [ ] Place `LastWornSort` beside `UnifiedFilter`, preserve the category/filter behavior, and add compact responsive styles. The sort select must remain at least 44px high.

- [ ] Add view tests that choose both directions, assert DOM card order, assert never-worn placement, and assert metadata is absent under Standard and present under either chronological order.

- [ ] Run and commit:

  ```bash
  npx vitest run src/features/sorting/LastWornSort.test.jsx src/features/wardrobe/WardrobeView.test.jsx src/features/outfits/OutfitsView.test.jsx
  git add src/domain/lastWorn.js src/features/sorting src/features/wardrobe/WardrobeView.jsx src/features/wardrobe/WardrobeView.test.jsx src/features/outfits/OutfitsView.jsx src/features/outfits/OutfitsView.test.jsx src/features/outfits/outfits.css src/styles.css
  git commit -m "feat: sort wardrobe and outfits by last worn"
  ```

## Task 5: Build the responsive week planner

**Files:**

- Create: `src/features/planner/WeekPlanner.jsx`
- Create: `src/features/planner/WeekPlanner.test.jsx`
- Create: `src/features/planner/OutfitPickerDialog.jsx`
- Create: `src/features/planner/OutfitPickerDialog.test.jsx`
- Create: `src/features/planner/planner.css`

- [ ] Build `OutfitPickerDialog` as a controlled modal. On open it calls `repository.listOutfits()`, applies `OUTFIT_FILTER_GROUPS`, applies `sortByLastWorn`, shows Needs-attention outfits disabled, and calls `onSelect(outfit)` only for valid outfits. Reuse `UnifiedFilter`, `LastWornSort`, and `LastWornMeta`; do not copy their logic.
- [ ] If picker sorting requests last-worn data while `last_worn_unavailable` is true, retain Standard order and show the same retryable metadata alert used by Wardrobe and Outfits.


  ```jsx
  <OutfitPickerDialog
    weekday={editingDay}
    repository={repository}
    labels={labels}
    advancedFilter={advancedFilter}
    onAdvancedFilterChange={onAdvancedFilterChange}
    onSelect={assignOutfit}
    onClose={() => setEditingDay(null)}
  />
  ```

- [ ] Build `WeekPlanner` with `active`, `repository`, `onLoad`, `onWear`, filter props, and injectable `today = new Date()`. Load only when active. Preserve the confirmed plan during mutations and replace state only after the repository succeeds.

  ```jsx
  const todayWeekday = currentWeekday(today);
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setSlots(await repository.listWeeklyPlan()); }
    catch (failure) { setError(failure.message || "Kunde inte ladda veckan."); }
    finally { setLoading(false); }
  }, [repository]);

  const assignOutfit = async (outfit) => {
    await repository.setWeeklyPlanSlot({ weekday: editingDay, outfitId: outfit.id });
    await reload();
    setEditingDay(null);
  };
  ```

- [ ] Render exactly Monday-Friday. Each planned slot exposes `Öppna <outfit>`, `Byt outfit`, and `Ta bort från <weekday>`; opening calls `onLoad(outfit.items, outfit)` and reuses the existing Dressing-room load flow. Show `Bär idag` only when `slot.weekday === todayWeekday`, an outfit exists, and it is not Needs attention. Call `onWear(outfit.items, outfit)` and leave the slot unchanged.

- [ ] Implement `Töm veckan` with an inline confirmation group. Call `clearWeeklyPlan()` only on confirmation; preserve state on failure and reload on success.

- [ ] Add mobile five-row styles and switch to five equal day cards at `min-width: 900px`. Include announced errors, 44px controls, full weekday accessible labels, and no dates/weekends/week navigation.

- [ ] Test initial load/error/retry, exactly five days, empty and filled states, assign/replace/remove, mutation failure preservation, clear confirmation/failure, Needs attention, Monday-Friday current-day behavior, weekend no-action behavior, shared filters, and picker sorting.

- [ ] Run and commit:

  ```bash
  npx vitest run src/features/planner/WeekPlanner.test.jsx src/features/planner/OutfitPickerDialog.test.jsx
  git add src/features/planner
  git commit -m "feat: add weekday outfit planner"
  ```

## Task 6: Wire the planner and exact wear refresh into App

**Files:**

- Modify: `src/App.jsx:1-18,24-31,180-390`
- Create: `src/features/planner/App.weekPlanner.test.jsx`
- Modify: `src/features/history/HistoryView.test.jsx:189-233`
- Modify: `src/styles.css:967-996`

- [ ] Import `WeekPlanner`, add `{ id: "week", label: "Vecka" }` between Outfits and History, and change the bottom navigation grid to five columns.

- [ ] Render the planner section with the shared filter props and existing exact-outfit wear bridge:

  ```jsx
  <section className="app-section" hidden={section !== "week"}>
    {typeof repository.listWeeklyPlan === "function" ? (
      <WeekPlanner
        repository={repository}
        active={section === "week"}
        onLoad={loadOutfit}
        onWear={(selection, outfit) => requestWear(selection, outfit)}
        context="Vecka"
        {...advancedFilterProps}
      />
    ) : (
      <div className="placeholder-section">
        <p>Vecka</p>
        <h1>Veckoplaneraren är inte tillgänglig än.</h1>
      </div>
    )}
  </section>
  ```

- [ ] After a successful `recordWear`, increment `outfitsRefreshKey` as well as History refresh and item refresh. This makes outfit last-worn sorting immediately reflect a planner or Outfits wear action.

- [ ] Add an App integration test that opens Vecka, chooses Monday's outfit, clicks `Bär idag` after setting fake system time to a Monday, confirms `WearDialog`, and asserts `recordWear` receives the exact item IDs and outfit ID while the Monday slot remains.

- [ ] Update navigation tests to expect five destinations and verify each target remains at least 44px through the existing CSS contract.

- [ ] Run and commit:

  ```bash
  npx vitest run src/features/planner/App.weekPlanner.test.jsx src/features/history/HistoryView.test.jsx src/features/dress/DressingRoom.test.jsx
  git add src/App.jsx src/styles.css src/features/planner/App.weekPlanner.test.jsx src/features/history/HistoryView.test.jsx src/features/dress/DressingRoom.test.jsx
  git commit -m "feat: integrate weekly planner navigation"
  ```

## Task 7: Verify the complete slice

**Files:** None unless verification exposes a defect.

- [ ] Run focused and full automated checks:

  ```bash
  npm run test:db
  npm test
  npm run build
  ```

  Expected: all exit 0; do not dismiss new warnings caused by this feature.

- [ ] Run the app and manually verify at phone and desktop widths:

  ```bash
  npm run dev
  ```

  Verify five visible weekdays, no dates/weekends, manual clear, current weekday action, Needs-attention blocking, picker filters/sorting, Wardrobe/Outfits chronological sorting, metadata visibility, and five-button bottom navigation.

- [ ] Review and commit only any verification fixes, then confirm `git status --short` contains only known user-owned paths.
