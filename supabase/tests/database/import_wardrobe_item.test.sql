begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

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

select has_function(
  'public',
  'import_wardrobe_item',
  array[
    'uuid', 'text', 'text', 'text', 'text[]', 'text[]', 'text', 'text[]',
    'double precision', 'double precision', 'double precision', 'double precision', 'integer'
  ],
  'import wardrobe RPC exists'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.import_wardrobe_item(uuid,text,text,text,text[],text[],text,text[],double precision,double precision,double precision,double precision,integer)'::regprocedure),
  true,
  'import wardrobe RPC is security definer'
);
select is(
  (select proconfig from pg_proc where oid = 'public.import_wardrobe_item(uuid,text,text,text,text[],text[],text,text[],double precision,double precision,double precision,double precision,integer)'::regprocedure),
  array['search_path=""']::text[],
  'import wardrobe RPC has empty search path'
);
select is(
  pg_temp.public_can_execute('public.import_wardrobe_item(uuid,text,text,text,text[],text[],text,text[],double precision,double precision,double precision,double precision,integer)'::regprocedure),
  false,
  'PUBLIC cannot import wardrobe items'
);
select is(
  has_function_privilege('anon', 'public.import_wardrobe_item(uuid,text,text,text,text[],text[],text,text[],double precision,double precision,double precision,double precision,integer)', 'EXECUTE'),
  false,
  'anon cannot import wardrobe items'
);
select is(
  has_function_privilege('authenticated', 'public.import_wardrobe_item(uuid,text,text,text,text[],text[],text,text[],double precision,double precision,double precision,double precision,integer)', 'EXECUTE'),
  true,
  'authenticated can import wardrobe items'
);

insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('41111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'import-a@wearit.test', '{"name":"Import A"}', now(), now()),
  ('42222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'import-b@wearit.test', '{"name":"Import B"}', now(), now());

select is(
  pg_temp.sqlstate_for($sql$
    select public.import_wardrobe_item(
      '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Anon', 'top', 'top', array['#112233'], array['cotton'],
      '41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/cutout.png',
      array[]::text[], 0.5, 0.4, 0.6, 0, 30
    )
  $sql$),
  '42501',
  'unauthenticated callers are rejected'
);

set local role authenticated;
set local request.jwt.claim.sub = '41111111-1111-4111-8111-111111111111';

select is(
  public.import_wardrobe_item(
    '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Navy cardigan', 'jacket', 'outerwear',
    array['#172033'], array['knit'],
    '41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/cutout.png',
    array['41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/details/label.webp'],
    0.5, 0.38, 0.66, 0, 40
  ),
  '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
  'owner can create an item with its stable ID'
);
select is((select count(*) from public.wardrobe_items where id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), 1::bigint, 'create inserts one row');
select is((select owner_id from public.wardrobe_items where id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), '41111111-1111-4111-8111-111111111111'::uuid, 'create assigns auth.uid as owner');
select is((select cutout_path from public.wardrobe_items where id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), '41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/cutout.png', 'create stores exact cutout path');
select is((select detail_image_paths from public.wardrobe_items where id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), array['41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/details/label.webp'], 'create stores reviewed details');
select is((select concat_ws('|', name, category, slot, array_to_string(colors, ','), array_to_string(tags, ',')) from public.wardrobe_items where id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), 'Navy cardigan|jacket|outerwear|#172033|knit', 'create stores reviewed metadata');
select is((select concat_ws('|', anchor_x, anchor_y, scale, rotation_degrees, layer_order) from public.wardrobe_items where id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), '0.5|0.38|0.66|0|40', 'create stores reviewed placement');

select is(
  public.import_wardrobe_item(
    '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Tailored cardigan', 'coat', 'outerwear',
    array['#101820', '#ffffff'], array['wool', 'smart'],
    '41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/cutout.png',
    array['41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/details/new-label.jpg'],
    0.52, 0.4, 0.7, -2, 44
  ),
  '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
  'stable rerun returns the existing ID'
);
select is((select count(*) from public.wardrobe_items where id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), 1::bigint, 'stable rerun does not duplicate the row');
select is((select concat_ws('|', name, category, slot, array_to_string(colors, ','), array_to_string(tags, ',')) from public.wardrobe_items where id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), 'Tailored cardigan|coat|outerwear|#101820,#ffffff|wool,smart', 'stable rerun updates reviewed metadata');
select is((select detail_image_paths from public.wardrobe_items where id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), array['41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/details/new-label.jpg'], 'stable rerun updates reviewed detail paths');
select is((select concat_ws('|', anchor_x, anchor_y, scale, rotation_degrees, layer_order) from public.wardrobe_items where id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), '0.52|0.4|0.7|-2|44', 'stable rerun updates reviewed placement');

select is(pg_temp.sqlstate_for($sql$select public.import_wardrobe_item('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Bad', 'top', 'top', '{}', '{}', '42222222-2222-4222-8222-222222222222/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/cutout.png', '{}', 0.5, 0.5, 0.5, 0, 30)$sql$), '22023', 'foreign-owner cutout path is rejected');
select is(pg_temp.sqlstate_for($sql$select public.import_wardrobe_item('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Bad', 'top', 'top', '{}', '{}', '41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9/cutout.png', '{}', 0.5, 0.5, 0.5, 0, 30)$sql$), '22023', 'wrong-item cutout path is rejected');
select is(pg_temp.sqlstate_for($sql$select public.import_wardrobe_item('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Bad', 'top', 'top', '{}', '{}', '41111111-1111-4111-8111-111111111111/items/../cutout.png', '{}', 0.5, 0.5, 0.5, 0, 30)$sql$), '22023', 'cutout traversal is rejected');
select is(pg_temp.sqlstate_for($sql$select public.import_wardrobe_item('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Bad', 'top', 'top', '{}', '{}', '41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/cutout.png', array['42222222-2222-4222-8222-222222222222/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/details/a.jpg'], 0.5, 0.5, 0.5, 0, 30)$sql$), '22023', 'foreign-owner detail path is rejected');
select is(pg_temp.sqlstate_for($sql$select public.import_wardrobe_item('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Bad', 'top', 'top', '{}', '{}', '41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/cutout.png', array['41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9/details/a.jpg'], 0.5, 0.5, 0.5, 0, 30)$sql$), '22023', 'wrong-item detail path is rejected');
select is(pg_temp.sqlstate_for($sql$select public.import_wardrobe_item('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Bad', 'top', 'top', '{}', '{}', '41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/cutout.png', array['41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/details/../a.jpg'], 0.5, 0.5, 0.5, 0, 30)$sql$), '22023', 'detail traversal is rejected');
select is(pg_temp.sqlstate_for($sql$select public.import_wardrobe_item('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Bad', 'top', 'top', '{}', '{}', '41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/cutout.png', array['41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/details/nested/a.jpg'], 0.5, 0.5, 0.5, 0, 30)$sql$), '22023', 'nested detail path is rejected');
select is(pg_temp.sqlstate_for($sql$select public.import_wardrobe_item('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Bad', 'top', 'top', '{}', '{}', '41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/cutout.png', array['41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/details/a.jpg','41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/details/a.jpg'], 0.5, 0.5, 0.5, 0, 30)$sql$), '22023', 'duplicate detail paths are rejected');
select is(pg_temp.sqlstate_for($sql$select public.import_wardrobe_item('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Bad', 'dress', 'top', '{}', '{}', '41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/cutout.png', '{}', 0.5, 0.5, 0.5, 0, 30)$sql$), '22023', 'category-slot mismatch is rejected');
select is(pg_temp.sqlstate_for($sql$select public.import_wardrobe_item('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '   ', 'top', 'top', '{}', '{}', '41111111-1111-4111-8111-111111111111/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/cutout.png', '{}', 0.5, 0.5, 0.5, 0, 30)$sql$), '22023', 'blank names are rejected');

set local request.jwt.claim.sub = '42222222-2222-4222-8222-222222222222';
select is(pg_temp.sqlstate_for($sql$select public.import_wardrobe_item('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Stolen', 'top', 'top', '{}', '{}', '42222222-2222-4222-8222-222222222222/items/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/cutout.png', '{}', 0.5, 0.5, 0.5, 0, 30)$sql$), '42501', 'foreign stable ID update is rejected');
reset role;
select is((select name from public.wardrobe_items where id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), 'Tailored cardigan', 'foreign update leaves owned row unchanged');

select * from finish();
rollback;
