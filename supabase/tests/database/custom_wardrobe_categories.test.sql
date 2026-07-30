begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

create function pg_temp.table_privileges(role_name name, relation regclass)
returns text[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(privilege order by privilege), '{}'::text[])
  from unnest(array['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[]) as privileges(privilege)
  where has_table_privilege(role_name, relation, privilege);
$$;

create function pg_temp.sqlstate_for(command text)
returns text language plpgsql set search_path = '' as $$
begin
  execute command;
  return null;
exception when others then return sqlstate;
end;
$$;

select has_table('public', 'wardrobe_categories', 'wardrobe categories table exists');
select has_column('public', 'wardrobe_categories', 'id', 'categories have an ID');
select has_column('public', 'wardrobe_categories', 'owner_id', 'categories have an owner');
select has_column('public', 'wardrobe_categories', 'normalized_name', 'categories normalize names');
select has_column('public', 'wardrobe_categories', 'slot', 'categories store a slot');
select col_is_fk('public', 'wardrobe_categories', 'owner_id', 'category owner references profiles');
select policies_are('public', 'wardrobe_categories', array[
  'owners_select_categories', 'owners_insert_categories',
  'owners_update_categories', 'owners_delete_categories'
], 'categories expose owner-only policies');
select is(pg_temp.table_privileges('anon', 'public.wardrobe_categories'), '{}'::text[], 'anon has no category privileges');
select is(pg_temp.table_privileges('authenticated', 'public.wardrobe_categories'), array['DELETE','INSERT','SELECT','UPDATE']::text[], 'authenticated has category CRUD privileges');
select has_function('public', 'wardrobe_slot_for_owner_category', array['uuid','text'], 'owner-aware slot resolver exists');

insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('71111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'categories-a@wearit.test', '{"name":"Category A"}', now(), now()),
  ('72222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'categories-b@wearit.test', '{"name":"Category B"}', now(), now());

insert into public.wardrobe_categories (owner_id, name, slot)
values ('71111111-1111-4111-8111-111111111111', 'Kavajer', 'outerwear');

select is((select name from public.wardrobe_categories where owner_id = '71111111-1111-4111-8111-111111111111'), 'Kavajer', 'category stores its name');
select is((select normalized_name from public.wardrobe_categories where owner_id = '71111111-1111-4111-8111-111111111111'), 'kavajer', 'category stores normalized name');
select is((select public.wardrobe_slot_for_owner_category('71111111-1111-4111-8111-111111111111', 'top')), 'top', 'built-in top resolves');
select is((select public.wardrobe_slot_for_owner_category('71111111-1111-4111-8111-111111111111', 'jacket')), 'outerwear', 'built-in jacket resolves');
select is((select public.wardrobe_slot_for_owner_category('71111111-1111-4111-8111-111111111111', (select id::text from public.wardrobe_categories where owner_id = '71111111-1111-4111-8111-111111111111'))), 'outerwear', 'owned custom category resolves');
select is((select public.wardrobe_slot_for_owner_category('72222222-2222-4222-8222-222222222222', (select id::text from public.wardrobe_categories where owner_id = '71111111-1111-4111-8111-111111111111'))), null, 'foreign custom category does not resolve');
select is(pg_temp.sqlstate_for($sql$
  insert into public.wardrobe_categories (owner_id, name, slot)
  values ('71111111-1111-4111-8111-111111111111', '  Kavajer  ', 'outerwear')
$sql$), '23514', 'category names must be trimmed');
select is(pg_temp.sqlstate_for($sql$
  insert into public.wardrobe_categories (owner_id, name, slot)
  values ('71111111-1111-4111-8111-111111111111', 'KAVAJER', 'outerwear')
$sql$), '23505', 'category names are unique case-insensitively per owner');
select is(pg_temp.sqlstate_for($sql$
  insert into public.wardrobe_categories (owner_id, name, slot)
  values ('71111111-1111-4111-8111-111111111111', 'Loose', 'invalid')
$sql$), '23514', 'category slots are restricted');

insert into public.wardrobe_categories (owner_id, name, slot)
values ('72222222-2222-4222-8222-222222222222', 'Kavajer', 'outerwear');

insert into public.wardrobe_items (id, owner_id, name, category, slot, cutout_path)
values ('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '71111111-1111-4111-8111-111111111111', 'A jacket', 'jacket', 'outerwear', '71111111-1111-4111-8111-111111111111/items/a.png');

set local role authenticated;
set local request.jwt.claim.sub = '71111111-1111-4111-8111-111111111111';
select is((select count(*) from public.wardrobe_categories), 1::bigint, 'owner sees only own categories');
select is(pg_temp.sqlstate_for($sql$
  insert into public.wardrobe_items (owner_id, name, category, slot, cutout_path)
  values ('71111111-1111-4111-8111-111111111111', 'Bad slot', 'jacket', 'top', '71111111-1111-4111-8111-111111111111/items/bad.png')
$sql$), '22023', 'item insert rejects a built-in category-slot mismatch');
select is(pg_temp.sqlstate_for($sql$
  insert into public.wardrobe_items (owner_id, name, category, slot, cutout_path)
  values ('71111111-1111-4111-8111-111111111111', 'Unknown', 'not-a-category', 'top', '71111111-1111-4111-8111-111111111111/items/unknown.png')
$sql$), '22023', 'item insert rejects an unknown category');
select is(pg_temp.sqlstate_for($sql$
  insert into public.wardrobe_items (owner_id, name, category, slot, cutout_path)
  values ('71111111-1111-4111-8111-111111111111', 'Foreign custom', (select id::text from public.wardrobe_categories where owner_id = '72222222-2222-4222-8222-222222222222'), 'outerwear', '71111111-1111-4111-8111-111111111111/items/foreign.png')
$sql$), '22023', 'item insert rejects a foreign custom category');
select is(pg_temp.sqlstate_for($sql$
  insert into public.wardrobe_items (owner_id, name, category, slot, cutout_path)
  values ('71111111-1111-4111-8111-111111111111', 'Custom bad slot', (select id::text from public.wardrobe_categories where owner_id = '71111111-1111-4111-8111-111111111111'), 'top', '71111111-1111-4111-8111-111111111111/items/custom-bad.png')
$sql$), '22023', 'item insert rejects a custom category-slot mismatch');

select is(public.update_wardrobe_item_with_labels(
  '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Custom jacket',
  (select id::text from public.wardrobe_categories where owner_id = '71111111-1111-4111-8111-111111111111'), 'outerwear',
  null, null, null, '{}'::text[], '{}'::text[], 0.5, 0.5, 0.5, 0, 30, '{}'::uuid[]
), '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid, 'item label update accepts an owned custom category');
select is(pg_temp.sqlstate_for($sql$
  select public.update_wardrobe_item_with_labels('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Bad', (select id::text from public.wardrobe_categories where owner_id = '71111111-1111-4111-8111-111111111111'), 'top', null, null, null, '{}'::text[], '{}'::text[], 0.5, 0.5, 0.5, 0, 30, '{}'::uuid[])
$sql$), '22023', 'item label update rejects a custom slot mismatch');
select is(pg_temp.sqlstate_for($sql$
  select public.update_wardrobe_item_with_labels('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Bad', (select id::text from public.wardrobe_categories where owner_id = '72222222-2222-4222-8222-222222222222'), 'outerwear', null, null, null, '{}'::text[], '{}'::text[], 0.5, 0.5, 0.5, 0, 30, '{}'::uuid[])
$sql$), '22023', 'item label update rejects a foreign custom category');

set local role authenticated;
set local request.jwt.claim.sub = '71111111-1111-4111-8111-111111111111';
select is(public.import_wardrobe_item(
  '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Built-in import', 'jacket', 'outerwear', '{}'::text[], '{}'::text[],
  '71111111-1111-4111-8111-111111111111/items/7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/cutout.png', '{}'::text[], 0.5, 0.5, 0.5, 0, 30
), '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid, 'built-in import behavior remains available');
select is(pg_temp.sqlstate_for($sql$
  select public.import_wardrobe_item('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'Custom import', (select id::text from public.wardrobe_categories where owner_id = '71111111-1111-4111-8111-111111111111'), 'outerwear', '{}'::text[], '{}'::text[], '71111111-1111-4111-8111-111111111111/items/7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3/cutout.png', '{}'::text[], 0.5, 0.5, 0.5, 0, 30)
$sql$), '22023', 'built-in import RPC does not accept custom categories');

select * from finish();
rollback;
