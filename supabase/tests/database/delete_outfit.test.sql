begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

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

-- Function contract and grants.
select has_function('public', 'delete_outfit', array['uuid'], 'delete_outfit exists');
select is((select prosecdef from pg_proc where oid = 'public.delete_outfit(uuid)'::regprocedure), true, 'delete_outfit is security definer');
select is((select proconfig from pg_proc where oid = 'public.delete_outfit(uuid)'::regprocedure), array['search_path=""']::text[], 'delete_outfit has an empty search path');
select is(pg_temp.public_can_execute('public.delete_outfit(uuid)'::regprocedure), false, 'PUBLIC cannot delete outfits');
select is(has_function_privilege('anon', 'public.delete_outfit(uuid)', 'EXECUTE'), false, 'anon cannot delete outfits');
select is(has_function_privilege('authenticated', 'public.delete_outfit(uuid)', 'EXECUTE'), true, 'authenticated can delete outfits');

-- Fixtures inserted as the migration role (bypasses RLS); profiles are created by the
-- auth.users trigger.
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('31111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'del-a@wearit.test', '{"name":"Del A"}', now(), now()),
  ('32222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'del-b@wearit.test', '{"name":"Del B"}', now(), now());

insert into public.wardrobe_items (id, owner_id, name, category, slot, cutout_path)
values
  ('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '31111111-1111-4111-8111-111111111111', 'A top', 'top', 'top', 'a/top.png'),
  ('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '31111111-1111-4111-8111-111111111111', 'A bottom', 'bottom', 'bottom', 'a/bottom.png');

insert into public.wardrobe_labels (id, owner_id, kind, season_key, name, locked)
values ('3ddddddd-dddd-4ddd-8ddd-ddddddddddd1', '31111111-1111-4111-8111-111111111111', 'theme', null, 'Rainy', false);

insert into public.outfits (id, owner_id, name, thumbnail_path)
values
  ('3ccccccc-cccc-4ccc-8ccc-ccccccccccc1', '31111111-1111-4111-8111-111111111111', 'Work look', '31111111-1111-4111-8111-111111111111/outfits/3ccccccc-cccc-4ccc-8ccc-ccccccccccc1/thumbnail-v1.webp'),
  ('3ccccccc-cccc-4ccc-8ccc-ccccccccccc2', '31111111-1111-4111-8111-111111111111', 'Second look', null);

insert into public.outfit_items (outfit_id, wardrobe_item_id, owner_id, slot, layer_order)
values
  ('3ccccccc-cccc-4ccc-8ccc-ccccccccccc1', '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '31111111-1111-4111-8111-111111111111', 'top', 20),
  ('3ccccccc-cccc-4ccc-8ccc-ccccccccccc1', '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '31111111-1111-4111-8111-111111111111', 'bottom', 30);

insert into public.outfit_labels (owner_id, outfit_id, label_id)
values ('31111111-1111-4111-8111-111111111111', '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1', '3ddddddd-dddd-4ddd-8ddd-ddddddddddd1');

insert into public.wear_events (id, owner_id, worn_at, outfit_id)
values ('3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', '31111111-1111-4111-8111-111111111111', '2026-07-01 10:00+00', '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1');

-- Unauthenticated callers are rejected before any owner context is set.
select is(pg_temp.sqlstate_for($sql$select public.delete_outfit('3ccccccc-cccc-4ccc-8ccc-ccccccccccc1')$sql$), '42501', 'delete_outfit rejects unauthenticated callers');

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

select is((select count(*) from public.outfit_items where outfit_id = '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'), 2::bigint, 'the outfit starts with two item associations');
select is((select count(*) from public.outfit_labels where outfit_id = '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'), 1::bigint, 'the outfit starts with one label');
select is((select outfit_id from public.wear_events where id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'), '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid, 'the wear event starts linked to the outfit');

select is(pg_temp.sqlstate_for($sql$select public.delete_outfit('39999999-9999-4999-8999-999999999999')$sql$), 'P0002', 'delete_outfit reports a missing outfit');

select is(public.delete_outfit('3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'), '31111111-1111-4111-8111-111111111111/outfits/3ccccccc-cccc-4ccc-8ccc-ccccccccccc1/thumbnail-v1.webp', 'delete_outfit returns the thumbnail path for cleanup');
select is((select count(*) from public.outfits where id = '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'), 0::bigint, 'the outfit row is removed');
select is((select count(*) from public.outfit_items where outfit_id = '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'), 0::bigint, 'the outfit item associations cascade away');
select is((select count(*) from public.outfit_labels where outfit_id = '3ccccccc-cccc-4ccc-8ccc-ccccccccccc1'), 0::bigint, 'the outfit label associations cascade away');
select is((select count(*) from public.wardrobe_labels where id = '3ddddddd-dddd-4ddd-8ddd-ddddddddddd1'), 1::bigint, 'the label itself survives the outfit deletion');
select is((select count(*) from public.wear_events where id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'), 1::bigint, 'the wear history survives the outfit deletion');
select is((select outfit_id from public.wear_events where id = '3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'), null, 'the wear event is detached from the deleted outfit');

-- A different owner cannot delete an outfit that is not theirs.
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
select is(pg_temp.sqlstate_for($sql$select public.delete_outfit('3ccccccc-cccc-4ccc-8ccc-ccccccccccc2')$sql$), 'P0002', 'delete_outfit refuses to delete another owner''s outfit');
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select is((select count(*) from public.outfits where id = '3ccccccc-cccc-4ccc-8ccc-ccccccccccc2'), 1::bigint, 'the foreign delete attempt left the outfit intact');

select finish();
rollback;
