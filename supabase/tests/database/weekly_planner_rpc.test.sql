begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

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

-- Function surface.
select has_function('public', 'set_weekly_plan_slot', array['integer', 'uuid'], 'set_weekly_plan_slot exists');
select is((select prosecdef from pg_proc where oid = 'public.set_weekly_plan_slot(integer,uuid)'::regprocedure), true, 'set_weekly_plan_slot is security definer');
select is((select proconfig from pg_proc where oid = 'public.set_weekly_plan_slot(integer,uuid)'::regprocedure), array['search_path=""']::text[], 'set_weekly_plan_slot has an empty search path');
select is(has_function_privilege('anon', 'public.set_weekly_plan_slot(integer,uuid)', 'EXECUTE'), false, 'anon cannot plan a weekday');
select is(has_function_privilege('authenticated', 'public.set_weekly_plan_slot(integer,uuid)', 'EXECUTE'), true, 'authenticated can plan a weekday');

-- Fixtures.
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('31111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'plan-rpc-a@wearit.test', '{"name":"Plan A"}', now(), now()),
  ('32222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'plan-rpc-b@wearit.test', '{"name":"Plan B"}', now(), now());

insert into public.outfits (id, owner_id, name)
values
  ('3ccccccc-cccc-4ccc-8ccc-ccccccccccc1', '31111111-1111-4111-8111-111111111111', 'Office'),
  ('3ccccccc-cccc-4ccc-8ccc-ccccccccccc2', '31111111-1111-4111-8111-111111111111', 'Evening'),
  ('3ddddddd-dddd-4ddd-8ddd-ddddddddddd1', '32222222-2222-4222-8222-222222222222', 'Foreign');

-- Unauthenticated callers are rejected before any write.
select is(pg_temp.sqlstate_for($sql$select public.set_weekly_plan_slot(1, '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid)$sql$), '42501', 'set_weekly_plan_slot rejects unauthenticated callers');

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

-- Weekday and ownership validation.
select is(pg_temp.sqlstate_for($sql$select public.set_weekly_plan_slot(6, '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid)$sql$), '22023', 'set_weekly_plan_slot rejects a weekend weekday');
select is(pg_temp.sqlstate_for($sql$select public.set_weekly_plan_slot(0, '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid)$sql$), '22023', 'set_weekly_plan_slot rejects an out-of-range weekday');
select is(pg_temp.sqlstate_for($sql$select public.set_weekly_plan_slot(2, '3ddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid)$sql$), '42501', 'set_weekly_plan_slot rejects another owner outfit');
select is(pg_temp.sqlstate_for($sql$select public.set_weekly_plan_slot(2, null)$sql$), '42501', 'set_weekly_plan_slot rejects a missing outfit');

-- Planning and replacing a weekday.
select lives_ok($sql$select public.set_weekly_plan_slot(1, '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid)$sql$, 'owner plans Monday through the RPC');
select is((select outfit_id from public.weekly_plan_slots where owner_id = auth.uid() and weekday = 1), '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid, 'Monday holds the chosen outfit');
select lives_ok($sql$select public.set_weekly_plan_slot(1, '3ccccccc-cccc-4ccc-8ccc-ccccccccccc2'::uuid)$sql$, 'owner replaces the Monday outfit through the RPC');
select is((select outfit_id from public.weekly_plan_slots where owner_id = auth.uid() and weekday = 1), '3ccccccc-cccc-4ccc-8ccc-ccccccccccc2'::uuid, 'Monday holds the replacement outfit');
select is((select count(*) from public.weekly_plan_slots where owner_id = auth.uid()), 1::bigint, 'replacing a weekday never creates a second slot');

reset role;
select * from finish();
rollback;
