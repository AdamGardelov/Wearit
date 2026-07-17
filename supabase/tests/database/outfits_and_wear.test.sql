begin;
create extension if not exists pgtap with schema extensions;
select plan(107);

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

create function pg_temp.public_can_execute(target regprocedure)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select coalesce(bool_or(acl.grantee = 0 and acl.privilege_type = 'EXECUTE'), false)
  from pg_proc as proc
  cross join lateral aclexplode(
    coalesce(proc.proacl, acldefault('f', proc.proowner))
  ) as acl
  where proc.oid = target;
$function$;

select has_table('public', 'outfits', 'outfits exists');
select has_table('public', 'outfit_items', 'outfit_items exists');
select has_table('public', 'wear_events', 'wear_events exists');
select has_table('public', 'wear_event_items', 'wear_event_items exists');
select has_view('public', 'wardrobe_item_last_worn', 'last-worn view exists');
select has_function('public', 'save_outfit', array['uuid', 'text', 'uuid[]', 'text'], 'save_outfit exists');
select has_function('public', 'record_wear', array['uuid[]', 'timestamp with time zone', 'uuid', 'text'], 'record_wear exists');
select has_function('public', 'archive_wardrobe_item', array['uuid'], 'archive RPC exists');
select has_function('public', 'restore_wardrobe_item', array['uuid'], 'restore RPC exists');

select policies_are('public', 'outfits', array['owners_select_outfits'], 'outfits expose only owner SELECT');
select policies_are('public', 'outfit_items', array['owners_select_outfit_items'], 'outfit items expose only owner SELECT');
select policies_are('public', 'wear_events', array['owners_select_wear_events'], 'wear events expose only owner SELECT');
select policies_are('public', 'wear_event_items', array['owners_select_wear_event_items'], 'wear event items expose only owner SELECT');

select is(pg_temp.table_privileges('anon', 'public.outfits'), '{}'::text[], 'anon has no outfit privileges');
select is(pg_temp.table_privileges('anon', 'public.outfit_items'), '{}'::text[], 'anon has no outfit item privileges');
select is(pg_temp.table_privileges('anon', 'public.wear_events'), '{}'::text[], 'anon has no wear event privileges');
select is(pg_temp.table_privileges('anon', 'public.wear_event_items'), '{}'::text[], 'anon has no wear event item privileges');
select is(pg_temp.table_privileges('authenticated', 'public.outfits'), array['SELECT']::text[], 'authenticated has SELECT-only outfits');
select is(pg_temp.table_privileges('authenticated', 'public.outfit_items'), array['SELECT']::text[], 'authenticated has SELECT-only outfit items');
select is(pg_temp.table_privileges('authenticated', 'public.wear_events'), array['SELECT']::text[], 'authenticated has SELECT-only wear events');
select is(pg_temp.table_privileges('authenticated', 'public.wear_event_items'), array['SELECT']::text[], 'authenticated has SELECT-only wear event items');
select is(pg_temp.table_privileges('anon', 'public.wardrobe_item_last_worn'), '{}'::text[], 'anon has no last-worn view privileges');
select is(pg_temp.table_privileges('authenticated', 'public.wardrobe_item_last_worn'), array['SELECT']::text[], 'authenticated can only SELECT last-worn view');
select is((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.wardrobe_item_last_worn'::regclass), true, 'last-worn view is a security invoker');

select is((select prosecdef from pg_proc where oid = 'public.save_outfit(uuid,text,uuid[],text)'::regprocedure), true, 'save_outfit is security definer');
select is((select proconfig from pg_proc where oid = 'public.save_outfit(uuid,text,uuid[],text)'::regprocedure), array['search_path=""']::text[], 'save_outfit has empty search path');
select is((select prosecdef from pg_proc where oid = 'public.record_wear(uuid[],timestamp with time zone,uuid,text)'::regprocedure), true, 'record_wear is security definer');
select is((select proconfig from pg_proc where oid = 'public.record_wear(uuid[],timestamp with time zone,uuid,text)'::regprocedure), array['search_path=""']::text[], 'record_wear has empty search path');
select is((select prosecdef from pg_proc where oid = 'public.archive_wardrobe_item(uuid)'::regprocedure), true, 'archive RPC is security definer');
select is((select proconfig from pg_proc where oid = 'public.archive_wardrobe_item(uuid)'::regprocedure), array['search_path=""']::text[], 'archive RPC has empty search path');
select is((select prosecdef from pg_proc where oid = 'public.restore_wardrobe_item(uuid)'::regprocedure), true, 'restore RPC is security definer');
select is((select proconfig from pg_proc where oid = 'public.restore_wardrobe_item(uuid)'::regprocedure), array['search_path=""']::text[], 'restore RPC has empty search path');
select ok(position('for update' in lower(pg_get_functiondef('public.save_outfit(uuid,text,uuid[],text)'::regprocedure))) > 0, 'save_outfit locks selected rows against concurrent archive');
select ok(position('for update' in lower(pg_get_functiondef('public.record_wear(uuid[],timestamp with time zone,uuid,text)'::regprocedure))) > 0, 'record_wear locks selected rows against concurrent archive');

select is(pg_temp.public_can_execute('public.save_outfit(uuid,text,uuid[],text)'::regprocedure), false, 'PUBLIC cannot save outfits');
select is(has_function_privilege('anon', 'public.save_outfit(uuid,text,uuid[],text)', 'EXECUTE'), false, 'anon cannot save outfits');
select is(has_function_privilege('authenticated', 'public.save_outfit(uuid,text,uuid[],text)', 'EXECUTE'), true, 'authenticated can save outfits');
select is(pg_temp.public_can_execute('public.record_wear(uuid[],timestamp with time zone,uuid,text)'::regprocedure), false, 'PUBLIC cannot record wear');
select is(has_function_privilege('anon', 'public.record_wear(uuid[],timestamp with time zone,uuid,text)', 'EXECUTE'), false, 'anon cannot record wear');
select is(has_function_privilege('authenticated', 'public.record_wear(uuid[],timestamp with time zone,uuid,text)', 'EXECUTE'), true, 'authenticated can record wear');
select is(pg_temp.public_can_execute('public.archive_wardrobe_item(uuid)'::regprocedure), false, 'PUBLIC cannot archive items');
select is(has_function_privilege('anon', 'public.archive_wardrobe_item(uuid)', 'EXECUTE'), false, 'anon cannot archive items');
select is(has_function_privilege('authenticated', 'public.archive_wardrobe_item(uuid)', 'EXECUTE'), true, 'authenticated can archive items');
select is(pg_temp.public_can_execute('public.restore_wardrobe_item(uuid)'::regprocedure), false, 'PUBLIC cannot restore items');
select is(has_function_privilege('anon', 'public.restore_wardrobe_item(uuid)', 'EXECUTE'), false, 'anon cannot restore items');
select is(has_function_privilege('authenticated', 'public.restore_wardrobe_item(uuid)', 'EXECUTE'), true, 'authenticated can restore items');

insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('31111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'outfit-a@wearit.test', '{"name":"Outfit A"}', now(), now()),
  ('32222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'outfit-b@wearit.test', '{"name":"Outfit B"}', now(), now());

insert into public.wardrobe_items (id, owner_id, name, category, slot, cutout_path)
values
  ('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '31111111-1111-4111-8111-111111111111', 'A top', 'top', 'top', 'a/top.png'),
  ('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '31111111-1111-4111-8111-111111111111', 'A bottom', 'bottom', 'bottom', 'a/bottom.png'),
  ('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', '31111111-1111-4111-8111-111111111111', 'A dress', 'dress', 'dress', 'a/dress.png'),
  ('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', '31111111-1111-4111-8111-111111111111', 'A jacket', 'jacket', 'outerwear', 'a/jacket.png'),
  ('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', '31111111-1111-4111-8111-111111111111', 'A second top', 'top', 'top', 'a/second-top.png'),
  ('3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '32222222-2222-4222-8222-222222222222', 'B top', 'top', 'top', 'b/top.png'),
  ('3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '32222222-2222-4222-8222-222222222222', 'B bottom', 'bottom', 'bottom', 'b/bottom.png');

select is(pg_temp.sqlstate_for($sql$select public.save_outfit(null, 'Anon', array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid, '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid], null)$sql$), '42501', 'save_outfit rejects unauthenticated callers');
select is(pg_temp.sqlstate_for($sql$select public.record_wear(array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid], '2026-07-01 10:00+00', null, null)$sql$), '42501', 'record_wear rejects unauthenticated callers');
select is(pg_temp.sqlstate_for($sql$select public.archive_wardrobe_item('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$sql$), '42501', 'archive RPC rejects unauthenticated callers');
select is(pg_temp.sqlstate_for($sql$select public.restore_wardrobe_item('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$sql$), '42501', 'restore RPC rejects unauthenticated callers');

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select is(pg_temp.sqlstate_for($sql$select public.save_outfit(null, '   ', array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid, '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid], null)$sql$), '22023', 'save_outfit rejects blank names');
select is(pg_temp.sqlstate_for($sql$select public.save_outfit(null, 'Tiny', array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid], null)$sql$), '22023', 'save_outfit rejects fewer than two items');
select is(pg_temp.sqlstate_for($sql$select public.save_outfit(null, 'Duplicate', array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid, '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid], null)$sql$), '22023', 'save_outfit rejects duplicate item IDs');
select is(pg_temp.sqlstate_for($sql$select public.save_outfit(null, 'Foreign', array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid, '3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid], null)$sql$), '22023', 'save_outfit rejects foreign items');
select is(pg_temp.sqlstate_for($sql$select public.save_outfit(null, 'Missing', array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid, '39999999-9999-4999-8999-999999999999'::uuid], null)$sql$), '22023', 'save_outfit rejects unavailable items');
select is(pg_temp.sqlstate_for($sql$select public.save_outfit(null, 'Same slot', array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid, '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'::uuid], null)$sql$), '22023', 'save_outfit rejects duplicate slots');
select is(pg_temp.sqlstate_for($sql$select public.save_outfit(null, 'Dress mix', array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid, '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'::uuid], null)$sql$), '22023', 'save_outfit rejects dresses mixed with separates');
select is(pg_temp.sqlstate_for($sql$select public.save_outfit('3ccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'Bad path', array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid, '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid], 'thumb.png')$sql$), '22023', 'save_outfit rejects malformed thumbnail paths');
select is(pg_temp.sqlstate_for($sql$select public.save_outfit('3ccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'Stable path', array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid, '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid], '31111111-1111-4111-8111-111111111111/outfits/3ccccccc-cccc-4ccc-8ccc-ccccccccccc2/thumbnail.webp')$sql$), '22023', 'save_outfit rejects overwrite-prone stable thumbnail paths');
select is(pg_temp.sqlstate_for($sql$select public.save_outfit('3ccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'Foreign path', array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid, '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid], '32222222-2222-4222-8222-222222222222/outfits/3ccccccc-cccc-4ccc-8ccc-ccccccccccc2/thumbnail-11111111-1111-4111-8111-111111111111.webp')$sql$), '22023', 'save_outfit rejects another owner thumbnail path');

create temporary table saved_ids (kind text primary key, id uuid not null);
select is(public.save_outfit('3ccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'Work look', array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid, '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid], '31111111-1111-4111-8111-111111111111/outfits/3ccccccc-cccc-4ccc-8ccc-ccccccccccc3/thumbnail-11111111-1111-4111-8111-111111111111.webp'), '3ccccccc-cccc-4ccc-8ccc-ccccccccccc3'::uuid, 'save_outfit creates a caller-supplied unused outfit ID');
insert into saved_ids values ('outfit', '3ccccccc-cccc-4ccc-8ccc-ccccccccccc3');
select is((select count(*) from public.outfits), 1::bigint, 'save_outfit creates one outfit');
select is((select thumbnail_path from public.outfits), '31111111-1111-4111-8111-111111111111/outfits/3ccccccc-cccc-4ccc-8ccc-ccccccccccc3/thumbnail-11111111-1111-4111-8111-111111111111.webp', 'save_outfit stores the exact owner-scoped versioned thumbnail path');
select is((select count(*) from public.outfit_items), 2::bigint, 'save_outfit creates one association per item');
select is((select string_agg(slot, ',' order by slot) from public.outfit_items), 'bottom,top', 'outfit associations snapshot item slots');
select is(public.save_outfit((select id from saved_ids where kind = 'outfit'), 'Evening', array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'::uuid, '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'::uuid], null), (select id from saved_ids where kind = 'outfit'), 'save_outfit returns the updated outfit ID');
select is((select name from public.outfits), 'Evening', 'save_outfit updates outfit metadata');
select is((select count(*) from public.outfit_items), 2::bigint, 'save_outfit replaces associations instead of appending');
select is((select string_agg(slot, ',' order by slot) from public.outfit_items), 'dress,outerwear', 'save_outfit installs replacement associations');

select is(pg_temp.sqlstate_for($sql$insert into public.outfits(owner_id, name) values ('31111111-1111-4111-8111-111111111111', 'Direct')$sql$), '42501', 'direct outfit insert is denied');
select is(pg_temp.sqlstate_for($sql$update public.outfit_items set layer_order = 99$sql$), '42501', 'direct outfit item update is denied');
select is(pg_temp.sqlstate_for($sql$delete from public.wear_events$sql$), '42501', 'direct wear event delete is denied');
select is(pg_temp.sqlstate_for($sql$update public.wear_event_items set owner_id = owner_id$sql$), '42501', 'direct wear event item update is denied');
select is(pg_temp.sqlstate_for($sql$delete from public.wear_event_items$sql$), '42501', 'direct wear event item delete is denied');
select is(pg_temp.sqlstate_for($sql$truncate table public.wear_event_items$sql$), '42501', 'wear event item truncate is denied');

select is(pg_temp.sqlstate_for($sql$select public.record_wear(array[]::uuid[], '2026-07-01 10:00+00', null, null)$sql$), '22023', 'record_wear rejects missing items');
select is(pg_temp.sqlstate_for($sql$select public.record_wear(array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'::uuid, '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'::uuid], '2026-07-01 10:00+00', null, null)$sql$), '22023', 'record_wear rejects duplicate item IDs');
select is(pg_temp.sqlstate_for($sql$select public.record_wear(array['3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid], '2026-07-01 10:00+00', null, null)$sql$), '22023', 'record_wear rejects foreign items');
select is(pg_temp.sqlstate_for($sql$select public.record_wear(array['39999999-9999-4999-8999-999999999999'::uuid], '2026-07-01 10:00+00', null, null)$sql$), '22023', 'record_wear rejects unavailable items');
select is(pg_temp.sqlstate_for($sql$select public.record_wear(array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'::uuid], null, null, null)$sql$), '22023', 'record_wear rejects missing worn date');
insert into saved_ids values ('wear', public.record_wear(array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'::uuid, '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'::uuid], '2026-07-02 12:00+00', (select id from saved_ids where kind = 'outfit'), '  '));
select is((select count(*) from public.wear_event_items), 2::bigint, 'record_wear snapshots every supplied item');
select is((select notes from public.wear_events), null::text, 'record_wear normalizes blank notes to null');
select lives_ok($sql$select public.save_outfit((select id from saved_ids where kind = 'outfit'), 'Changed later', array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid, '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid], null)$sql$, 'an outfit can be changed after it is worn');
select is((select string_agg(wardrobe_item_id::text, ',' order by wardrobe_item_id) from public.wear_event_items), '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3,3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'later outfit changes do not rewrite wear snapshots');
select lives_ok($sql$select public.record_wear(array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid], '2026-07-04 12:00+00', null, 'newer')$sql$, 'record_wear accepts an individual active item');
select is((select last_worn_at from public.wardrobe_item_last_worn where wardrobe_item_id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), '2026-07-04 12:00+00'::timestamptz, 'last-worn view returns the newest wear date');

select is(pg_temp.sqlstate_for($sql$update public.wardrobe_items set status = 'archived', archived_at = now() where id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$sql$), '42501', 'direct wardrobe status updates are denied');
select is(pg_temp.affected_rows($sql$update public.wardrobe_items set name = 'A top renamed', tags = array['favorite'], updated_at = now() where id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$sql$), 1::bigint, 'allowed wardrobe metadata remains updatable');
select public.archive_wardrobe_item('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
select is((select status from public.wardrobe_items where id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), 'archived', 'archive RPC updates item status');
select is((select needs_attention from public.outfits where id = (select id from saved_ids where kind = 'outfit')), true, 'archive RPC marks referencing outfits for attention');
select is((select count(*) from public.wear_event_items where wardrobe_item_id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), 1::bigint, 'archive flow preserves existing wear snapshots');
select is(pg_temp.sqlstate_for($sql$select public.save_outfit(null, 'Archived', array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid, '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid], null)$sql$), '22023', 'save_outfit rejects archived items');
select is(pg_temp.sqlstate_for($sql$select public.record_wear(array['3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid], '2026-07-05 12:00+00', null, null)$sql$), '22023', 'record_wear rejects archived items');
select public.archive_wardrobe_item('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
select public.restore_wardrobe_item('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
select is((select status from public.wardrobe_items where id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), 'active', 'restore RPC reactivates an owned archived item');
select is((select needs_attention from public.outfits where id = (select id from saved_ids where kind = 'outfit')), true, 'restore keeps attention while another referenced item is archived');
select public.restore_wardrobe_item('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
select is((select status from public.wardrobe_items where id = '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'), 'active', 'restore RPC reactivates the other archived item');
select is((select needs_attention from public.outfits where id = (select id from saved_ids where kind = 'outfit')), false, 'restore clears attention after every referenced item is active');
select is(pg_temp.sqlstate_for($sql$select public.restore_wardrobe_item('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$sql$), '42501', 'restore RPC rejects active items');
select public.archive_wardrobe_item('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');

set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
select is((select count(*) from public.outfits), 0::bigint, 'other user sees zero outfits');
select is((select count(*) from public.outfit_items), 0::bigint, 'other user sees zero outfit items');
select is((select count(*) from public.wear_events), 0::bigint, 'other user sees zero wear events');
select is((select count(*) from public.wear_event_items), 0::bigint, 'other user sees zero wear event items');
select is((select count(*) from public.wardrobe_item_last_worn), 0::bigint, 'other user sees zero last-worn rows');
select is(pg_temp.sqlstate_for(format($sql$select public.save_outfit(%L, 'Stolen', array['3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid, '3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid], null)$sql$, (select id from saved_ids where kind = 'outfit'))), '42501', 'save_outfit rejects a foreign outfit update');
select is(pg_temp.sqlstate_for(format($sql$select public.record_wear(array['3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid], '2026-07-06 12:00+00', %L, null)$sql$, (select id from saved_ids where kind = 'outfit'))), '42501', 'record_wear rejects a foreign outfit');
select is(pg_temp.sqlstate_for($sql$select public.archive_wardrobe_item('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$sql$), '42501', 'archive RPC rejects foreign items');
select is(pg_temp.sqlstate_for($sql$select public.restore_wardrobe_item('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$sql$), '42501', 'restore RPC rejects foreign items');

reset role;
select * from finish();
rollback;
