-- Reusable, undated Monday-to-Friday outfit planner. At most five owner-scoped rows, one per
-- ISO weekday 1..5, each pointing at a saved outfit. An absent row is an empty day. The plan
-- stores intent only; the wear_events model remains authoritative for actual use.
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

-- Exact-outfit last-worn. Only wear events carrying a saved outfit_id participate; wearing the
-- same garments as a loose composition never counts as wearing the saved outfit. Security
-- invoker so the owner-scoped base-table RLS on wear_events remains authoritative.
create view public.outfit_last_worn
with (security_invoker = true)
as
select owner_id, outfit_id, max(worn_at) as last_worn_at
from public.wear_events
where outfit_id is not null
group by owner_id, outfit_id;

revoke all privileges on table public.outfit_last_worn from anon, authenticated;
grant select on table public.outfit_last_worn to authenticated;
