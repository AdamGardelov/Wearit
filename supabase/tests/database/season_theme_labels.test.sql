begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

create function pg_temp.table_privileges(role_name name, relation regclass)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(privilege order by privilege), '{}'::text[])
  from unnest(array[
    'DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
  ]::text[]) as privileges(privilege)
  where has_table_privilege(role_name, relation, privilege);
$$;

create function pg_temp.sqlstate_for(command text)
returns text language plpgsql set search_path = ''
as $$
begin
  execute command;
  return null;
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.affected_rows(command text)
returns bigint language plpgsql set search_path = ''
as $$
declare affected bigint;
begin
  execute command;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Signatures used by has_function_privilege.
create function pg_temp.update_sig() returns text language sql immutable as $$
  select 'public.update_wardrobe_item_with_labels(uuid, text, text, text, text, text, text, text[], text[], double precision, double precision, double precision, double precision, integer, uuid[])';
$$;
create function pg_temp.save_sig() returns text language sql immutable as $$
  select 'public.save_outfit_with_labels(uuid, text, uuid[], integer[], text, uuid[])';
$$;

-- Structural / privilege invariants (owner-neutral).
select is(pg_temp.table_privileges('authenticated', 'public.wardrobe_labels'),
  array['DELETE', 'INSERT', 'SELECT']::text[],
  'authenticated has table DELETE/INSERT/SELECT on labels while UPDATE is column-scoped');
select is(pg_temp.table_privileges('authenticated', 'public.wardrobe_item_labels'),
  array['SELECT']::text[], 'authenticated can only read item label assignments');
select is(pg_temp.table_privileges('authenticated', 'public.outfit_labels'),
  array['SELECT']::text[], 'authenticated can only read outfit label assignments');
select is(pg_temp.table_privileges('anon', 'public.wardrobe_labels'),
  '{}'::text[], 'anon has no label privileges');

select is((select prosecdef from pg_proc where oid = pg_temp.update_sig()::regprocedure),
  true, 'item label RPC is security definer');
select is((select proconfig from pg_proc where oid = pg_temp.update_sig()::regprocedure),
  array['search_path=""']::text[], 'item label RPC has an empty search path');
select is(has_function_privilege('anon', pg_temp.update_sig(), 'EXECUTE'),
  false, 'anon cannot execute the item label RPC');
select is(has_function_privilege('authenticated', pg_temp.update_sig(), 'EXECUTE'),
  true, 'authenticated can execute the item label RPC');

select is((select prosecdef from pg_proc where oid = pg_temp.save_sig()::regprocedure),
  true, 'outfit label RPC is security definer');
select is((select proconfig from pg_proc where oid = pg_temp.save_sig()::regprocedure),
  array['search_path=""']::text[], 'outfit label RPC has an empty search path');
select is(has_function_privilege('anon', pg_temp.save_sig(), 'EXECUTE'),
  false, 'anon cannot execute the outfit label RPC');
select is(has_function_privilege('authenticated', pg_temp.save_sig(), 'EXECUTE'),
  true, 'authenticated can execute the outfit label RPC');

-- Two owners via the profile trigger (which now seeds seasons).
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'labels-a@wearit.test', '{"name":"User A"}', now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'labels-b@wearit.test', '{"name":"User B"}', now(), now());

select is((select count(*) from public.wardrobe_labels
  where owner_id = '11111111-1111-4111-8111-111111111111' and kind = 'season'),
  4::bigint, 'a new profile receives four seasons');
select is((select string_agg(season_key, ',' order by season_key) from public.wardrobe_labels
  where owner_id = '11111111-1111-4111-8111-111111111111' and kind = 'season'),
  'autumn,spring,summer,winter', 'the four fixed season keys are seeded');
select is((select name from public.wardrobe_labels
  where owner_id = '11111111-1111-4111-8111-111111111111' and season_key = 'summer'),
  'Summer', 'seasons store canonical English names');
select is((select bool_and(locked) from public.wardrobe_labels
  where owner_id = '11111111-1111-4111-8111-111111111111' and kind = 'season'),
  true, 'seeded seasons are locked');
select is((select count(*) from public.wardrobe_labels
  where owner_id = '22222222-2222-4222-8222-222222222222' and kind = 'season'),
  4::bigint, 'the second new profile also receives four seasons');

insert into public.wardrobe_items (id, owner_id, name, category, slot, cutout_path) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'A top', 'top', 'top', '11111111-1111-4111-8111-111111111111/items/atop.png'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '11111111-1111-4111-8111-111111111111', 'A bottom', 'bottom', 'bottom', '11111111-1111-4111-8111-111111111111/items/abot.png'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '22222222-2222-4222-8222-222222222222', 'B top', 'top', 'top', '22222222-2222-4222-8222-222222222222/items/btop.png');

-- Capture a foreign label id so the caller can reference it without reading it under RLS.
create temp table foreign_label as
  select id from public.wardrobe_labels
  where owner_id = '22222222-2222-4222-8222-222222222222' and season_key = 'summer';
grant select on foreign_label to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select is((select count(*) from public.wardrobe_labels), 4::bigint,
  'user A sees only their own four labels under RLS');
select is((select count(*) from public.wardrobe_labels
  where owner_id = '22222222-2222-4222-8222-222222222222'), 0::bigint,
  'user A cannot read user B labels');

select is(pg_temp.affected_rows($cmd$
  insert into public.wardrobe_labels (owner_id, kind, season_key, name, locked)
  values ('11111111-1111-4111-8111-111111111111', 'theme', null, 'Rainy day', false)
$cmd$), 1::bigint, 'user A can create an owned theme');

select is(pg_temp.affected_rows($cmd$
  update public.wardrobe_labels set name = 'Hacked', updated_at = now() where season_key = 'summer'
$cmd$), 0::bigint, 'a locked season cannot be renamed');
select is(pg_temp.affected_rows($cmd$
  delete from public.wardrobe_labels where season_key = 'summer'
$cmd$), 0::bigint, 'a locked season cannot be deleted');

select is(pg_temp.sqlstate_for($cmd$
  insert into public.wardrobe_labels (owner_id, kind, season_key, name, locked)
  values ('11111111-1111-4111-8111-111111111111', 'theme', null, '', false)
$cmd$), '23514', 'a blank theme name is rejected');
select is(pg_temp.sqlstate_for($cmd$
  insert into public.wardrobe_labels (owner_id, kind, season_key, name, locked)
  values ('11111111-1111-4111-8111-111111111111', 'theme', null, 'RAINY DAY', false)
$cmd$), '23505', 'a case-insensitive duplicate theme name is rejected');

select is(pg_temp.affected_rows($cmd$
  update public.wardrobe_labels set name = 'Storm', updated_at = now()
  where kind = 'theme' and normalized_name = 'rainy day'
$cmd$), 1::bigint, 'user A can rename an owned theme');

-- Item label assignment through the RPC.
select is(
  public.update_wardrobe_item_with_labels(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'A top', 'top', 'top', null, null, null,
    array['#101010']::text[], array[]::text[], 0.5, 0.34, 0.6, 0, 30,
    array[
      (select id from public.wardrobe_labels where season_key = 'summer'),
      (select id from public.wardrobe_labels where kind = 'theme')
    ]::uuid[]),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
  'assigning labels returns the item id');
select is((select count(*) from public.wardrobe_item_labels
  where wardrobe_item_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  2::bigint, 'the item receives both submitted labels');

select is(pg_temp.affected_rows($cmd$
  select public.update_wardrobe_item_with_labels(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'A top', 'top', 'top', null, null, null,
    array['#101010']::text[], array[]::text[], 0.5, 0.34, 0.6, 0, 30,
    array[(select id from public.wardrobe_labels where season_key = 'winter')]::uuid[])
$cmd$), 1::bigint, 'reassignment executes');
select is((select count(*) from public.wardrobe_item_labels
  where wardrobe_item_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), 1::bigint,
  'reassignment fully replaces the previous label set');
select is((select label_id from public.wardrobe_item_labels
  where wardrobe_item_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  (select id from public.wardrobe_labels where season_key = 'winter'),
  'the surviving assignment is the resubmitted label');

select is(pg_temp.sqlstate_for($cmd$
  select public.update_wardrobe_item_with_labels(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'B top', 'top', 'top', null, null, null,
    array[]::text[], array[]::text[], 0.5, 0.34, 0.6, 0, 30, array[]::uuid[])
$cmd$), '42501', 'assignment rejects an item owned by another user');
select is(pg_temp.sqlstate_for($cmd$
  select public.update_wardrobe_item_with_labels(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'A top', 'top', 'top', null, null, null,
    array[]::text[], array[]::text[], 0.5, 0.34, 0.6, 0, 30,
    array[(select id from foreign_label)]::uuid[])
$cmd$), '22023', 'assignment rejects a label owned by another user');
select is(pg_temp.sqlstate_for($cmd$
  select public.update_wardrobe_item_with_labels(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'A top', 'top', 'top', null, null, null,
    array[]::text[], array[]::text[], 0.5, 0.34, 0.6, 0, 30,
    array[
      (select id from public.wardrobe_labels where season_key = 'summer'),
      (select id from public.wardrobe_labels where season_key = 'summer')
    ]::uuid[])
$cmd$), '22023', 'assignment rejects duplicate labels');

-- Outfit label assignment through the wrapper.
select is(
  public.save_outfit_with_labels(
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'Weekend look',
    array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2']::uuid[],
    array[10, 20]::integer[], null,
    array[
      (select id from public.wardrobe_labels where season_key = 'summer'),
      (select id from public.wardrobe_labels where kind = 'theme')
    ]::uuid[]),
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid,
  'saving an outfit with labels returns the outfit id');
select is((select count(*) from public.outfit_labels
  where outfit_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'), 2::bigint,
  'the outfit receives both submitted labels');
select is(pg_temp.affected_rows($cmd$
  select public.save_outfit_with_labels(
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'Weekend look',
    array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2']::uuid[],
    array[10, 20]::integer[], null,
    array[(select id from public.wardrobe_labels where season_key = 'winter')]::uuid[])
$cmd$), 1::bigint, 're-saving executes');
select is((select count(*) from public.outfit_labels
  where outfit_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'), 1::bigint,
  're-saving fully replaces the outfit label set');
select is(pg_temp.sqlstate_for($cmd$
  select public.save_outfit_with_labels(
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'Weekend look',
    array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2']::uuid[],
    array[10, 20]::integer[], null,
    array[(select id from foreign_label)]::uuid[])
$cmd$), '22023', 'outfit save rejects a label owned by another user');

-- Assign the theme to the item and outfit, then prove deletion cascades yet preserves data.
select public.update_wardrobe_item_with_labels(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'A top', 'top', 'top', null, null, null,
  array[]::text[], array[]::text[], 0.5, 0.34, 0.6, 0, 30,
  array[(select id from public.wardrobe_labels where kind = 'theme')]::uuid[]);
select public.save_outfit_with_labels(
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'Weekend look',
  array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2']::uuid[],
  array[10, 20]::integer[], null,
  array[(select id from public.wardrobe_labels where kind = 'theme')]::uuid[]);

select lives_ok($cmd$
  select public.record_wear(
    array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2']::uuid[],
    now(), 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid, null)
$cmd$, 'a wear event records the labeled outfit');

select is(pg_temp.affected_rows($cmd$
  delete from public.wardrobe_labels where kind = 'theme'
$cmd$), 1::bigint, 'user A can delete their own theme');
select is((select count(*) from public.wardrobe_item_labels
  where wardrobe_item_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), 0::bigint,
  'deleting a theme cascades its item assignment');
select is((select count(*) from public.outfit_labels
  where outfit_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'), 0::bigint,
  'deleting a theme cascades its outfit assignment');
select is((select count(*) from public.wardrobe_items
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), 1::bigint,
  'deleting a theme preserves the wardrobe item');
select is((select count(*) from public.outfits
  where id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'), 1::bigint,
  'deleting a theme preserves the outfit');
select is((select count(*) from public.wear_events
  where outfit_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'), 1::bigint,
  'deleting a theme preserves wear history');

-- Re-add an item label so cross-owner isolation is a real test, then switch to user B.
select public.update_wardrobe_item_with_labels(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'A top', 'top', 'top', null, null, null,
  array[]::text[], array[]::text[], 0.5, 0.34, 0.6, 0, 30,
  array[(select id from public.wardrobe_labels where season_key = 'summer')]::uuid[]);

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

select is((select count(*) from public.wardrobe_labels
  where owner_id = '11111111-1111-4111-8111-111111111111'), 0::bigint,
  'user B cannot read user A labels');
select is((select count(*) from public.wardrobe_item_labels
  where owner_id = '11111111-1111-4111-8111-111111111111'), 0::bigint,
  'user B cannot read user A item assignments');

reset role;
select * from finish();
rollback;
