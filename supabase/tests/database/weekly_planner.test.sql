begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

create function pg_temp.table_privileges(role_name name, relation regclass)
returns text[]
language sql
stable
set search_path = ''
as $function$
  select coalesce(array_agg(privilege order by privilege), '{}'::text[])
  from unnest(array[
    'DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
  ]::text[]) as privileges(privilege)
  where has_table_privilege(role_name, relation, privilege);
$function$;

create function pg_temp.sqlstate_for(command text)
returns text
language plpgsql
set search_path = ''
as $function$
begin
  execute command;
  return null;
exception
  when others then return sqlstate;
end;
$function$;

create function pg_temp.affected_rows(command text)
returns bigint
language plpgsql
set search_path = ''
as $function$
declare
  affected bigint;
begin
  execute command;
  get diagnostics affected = row_count;
  return affected;
end;
$function$;

-- Schema surface.
select has_table('public', 'weekly_plan_slots', 'weekly_plan_slots exists');
select has_view('public', 'outfit_last_worn', 'outfit_last_worn view exists');
select policies_are(
  'public',
  'weekly_plan_slots',
  array[
    'owners_select_weekly_plan',
    'owners_insert_weekly_plan',
    'owners_update_weekly_plan',
    'owners_delete_weekly_plan'
  ],
  'weekly plan slots expose one policy per owner action'
);

-- Table privileges.
select is(pg_temp.table_privileges('anon', 'public.weekly_plan_slots'), '{}'::text[], 'anon has no planner privileges');
select is(pg_temp.table_privileges('authenticated', 'public.weekly_plan_slots'), array['DELETE', 'INSERT', 'SELECT']::text[], 'authenticated has row-level SELECT/INSERT/DELETE only');
select is(has_column_privilege('authenticated', 'public.weekly_plan_slots', 'outfit_id', 'UPDATE'), true, 'authenticated may update the planned outfit');
select is(has_column_privilege('authenticated', 'public.weekly_plan_slots', 'updated_at', 'UPDATE'), true, 'authenticated may update the slot timestamp');
select is(has_column_privilege('authenticated', 'public.weekly_plan_slots', 'weekday', 'UPDATE'), false, 'authenticated cannot rewrite a slot weekday');
select is(pg_temp.table_privileges('anon', 'public.outfit_last_worn'), '{}'::text[], 'anon has no outfit last-worn privileges');
select is(pg_temp.table_privileges('authenticated', 'public.outfit_last_worn'), array['SELECT']::text[], 'authenticated can only SELECT outfit last-worn');
select is((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.outfit_last_worn'::regclass), true, 'outfit last-worn is security invoker');

-- Fixtures: two owners, three outfits, and owner A's wear events.
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('31111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'plan-a@wearit.test', '{"name":"Plan A"}', now(), now()),
  ('32222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'plan-b@wearit.test', '{"name":"Plan B"}', now(), now());

insert into public.outfits (id, owner_id, name)
values
  ('3ccccccc-cccc-4ccc-8ccc-ccccccccccc1', '31111111-1111-4111-8111-111111111111', 'Office'),
  ('3ccccccc-cccc-4ccc-8ccc-ccccccccccc2', '31111111-1111-4111-8111-111111111111', 'Evening'),
  ('3ddddddd-dddd-4ddd-8ddd-ddddddddddd1', '32222222-2222-4222-8222-222222222222', 'Foreign');

insert into public.wear_events (owner_id, worn_at, outfit_id)
values
  ('31111111-1111-4111-8111-111111111111', '2026-07-01 10:00+00', '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  ('31111111-1111-4111-8111-111111111111', '2026-07-10 10:00+00', '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  ('31111111-1111-4111-8111-111111111111', '2026-07-25 10:00+00', null);

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

-- Existing owners migrate to an empty planner.
select is((select count(*) from public.weekly_plan_slots), 0::bigint, 'a new planner starts empty');

-- Weekday constraint rejects weekends and out-of-range values.
select is(pg_temp.sqlstate_for($sql$insert into public.weekly_plan_slots(owner_id, weekday, outfit_id) values (auth.uid(), 6, '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid)$sql$), '23514', 'Saturday is rejected');
select is(pg_temp.sqlstate_for($sql$insert into public.weekly_plan_slots(owner_id, weekday, outfit_id) values (auth.uid(), 0, '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid)$sql$), '23514', 'Sunday is rejected');

-- Composite foreign key rejects another owner's outfit structurally.
select is(pg_temp.sqlstate_for($sql$insert into public.weekly_plan_slots(owner_id, weekday, outfit_id) values (auth.uid(), 2, '3ddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid)$sql$), '23503', 'a foreign outfit is rejected structurally');

-- Owner plans Monday and reuses the same outfit on Wednesday.
select lives_ok($sql$insert into public.weekly_plan_slots(owner_id, weekday, outfit_id) values (auth.uid(), 1, '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid)$sql$, 'owner plans Monday');
select lives_ok($sql$insert into public.weekly_plan_slots(owner_id, weekday, outfit_id) values (auth.uid(), 3, '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid)$sql$, 'the same outfit may be reused on another weekday');
select is((select count(*) from public.weekly_plan_slots), 2::bigint, 'two weekdays are planned');
select is(pg_temp.sqlstate_for($sql$insert into public.weekly_plan_slots(owner_id, weekday, outfit_id) values (auth.uid(), 1, '3ccccccc-cccc-4ccc-8ccc-ccccccccccc2'::uuid)$sql$), '23505', 'only one outfit is allowed per weekday');

-- The weekday column is immutable to authenticated owners.
select is(pg_temp.sqlstate_for($sql$update public.weekly_plan_slots set weekday = 2 where weekday = 1$sql$), '42501', 'authenticated owners cannot move a slot to a different weekday');

-- Replace the Monday outfit through the granted columns.
select lives_ok($sql$update public.weekly_plan_slots set outfit_id = '3ccccccc-cccc-4ccc-8ccc-ccccccccccc2'::uuid, updated_at = now() where weekday = 1$sql$, 'owner replaces the Monday outfit');
select is((select outfit_id from public.weekly_plan_slots where weekday = 1), '3ccccccc-cccc-4ccc-8ccc-ccccccccccc2'::uuid, 'the Monday slot points at the replacement outfit');

-- The exact-outfit last-worn view returns the newest exact wear and ignores item-only events.
select is((select last_worn_at from public.outfit_last_worn where outfit_id = '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'), '2026-07-10 10:00+00'::timestamptz, 'outfit last-worn returns the newest exact wear event');
select is((select count(*) from public.outfit_last_worn), 1::bigint, 'an item-only wear event never appears as an outfit wear');

-- Owner isolation.
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
select is((select count(*) from public.weekly_plan_slots), 0::bigint, 'another owner sees none of the first owner plan');
select is(pg_temp.sqlstate_for($sql$insert into public.weekly_plan_slots(owner_id, weekday, outfit_id) values (auth.uid(), 1, '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid)$sql$), '23503', 'an owner cannot plan another owner outfit even with its UUID');

set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

-- Deleting a saved outfit cascades to only the weekdays that referenced it.
select lives_ok($sql$select public.delete_outfit('3ccccccc-cccc-4ccc-8ccc-ccccccccccc2')$sql$, 'owner deletes the replacement outfit');
select is((select count(*) from public.weekly_plan_slots where weekday = 1), 0::bigint, 'deleting an outfit empties the weekday that pointed at it');
select is((select outfit_id from public.weekly_plan_slots where weekday = 3), '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid, 'other weekdays keep their outfit through the cascade');
select is((select count(*) from public.weekly_plan_slots), 1::bigint, 'only the referencing slot cascades away');

-- Clearing one weekday removes exactly that slot.
select is(pg_temp.affected_rows($sql$delete from public.weekly_plan_slots where weekday = 3$sql$), 1::bigint, 'clearing one weekday removes exactly one slot');
select is((select count(*) from public.weekly_plan_slots), 0::bigint, 'the planner is empty after clearing the last slot');

-- Clearing the whole week removes every owner slot idempotently.
select lives_ok($sql$insert into public.weekly_plan_slots(owner_id, weekday, outfit_id) values (auth.uid(), 1, '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid), (auth.uid(), 2, '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid)$sql$, 'owner plans two weekdays again');
select is((select count(*) from public.weekly_plan_slots), 2::bigint, 'two weekdays are planned before the clear');
select is(pg_temp.affected_rows($sql$delete from public.weekly_plan_slots where owner_id = auth.uid()$sql$), 2::bigint, 'clear the week removes every planned slot');
select is((select count(*) from public.weekly_plan_slots), 0::bigint, 'the week is empty after Töm veckan');

reset role;
select * from finish();
rollback;
