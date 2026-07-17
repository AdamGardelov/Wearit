begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

create function pg_temp.table_privileges(role_name name, relation regclass)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(privilege order by privilege), '{}'::text[])
  from unnest(array[
    'DELETE',
    'INSERT',
    'MAINTAIN',
    'REFERENCES',
    'SELECT',
    'TRIGGER',
    'TRUNCATE',
    'UPDATE'
  ]::text[]) as privileges(privilege)
  where has_table_privilege(role_name, relation, privilege);
$$;

create function pg_temp.sqlstate_for(command text)
returns text
language plpgsql
set search_path = ''
as $$
begin
  execute command;
  return null;
exception
  when others then
    return sqlstate;
end;
$$;

create function pg_temp.affected_rows(command text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  affected bigint;
begin
  execute command;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

select is(
  pg_temp.table_privileges('anon', 'public.profiles'),
  '{}'::text[],
  'anon has no profile table privileges'
);
select is(
  pg_temp.table_privileges('anon', 'public.wardrobe_items'),
  '{}'::text[],
  'anon has no wardrobe item table privileges'
);
select is(
  pg_temp.table_privileges('authenticated', 'public.profiles'),
  array['SELECT', 'UPDATE']::text[],
  'authenticated has only intended profile privileges'
);
select is(
  pg_temp.table_privileges('authenticated', 'public.wardrobe_items'),
  array['INSERT', 'SELECT']::text[],
  'authenticated has table INSERT/SELECT while metadata UPDATE is column-scoped'
);

select is(
  (
    select coalesce(bool_or(acl.grantee = 0 and acl.privilege_type = 'EXECUTE'), false)
    from pg_proc as proc
    cross join lateral aclexplode(
      coalesce(proc.proacl, acldefault('f', proc.proowner))
    ) as acl
    where proc.oid = 'public.create_profile_for_user()'::regprocedure
  ),
  false,
  'profile trigger function is not executable by PUBLIC'
);
select is(
  has_function_privilege(
    'anon',
    'public.create_profile_for_user()',
    'EXECUTE'
  ),
  false,
  'profile trigger function is not executable by anon'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.create_profile_for_user()',
    'EXECUTE'
  ),
  false,
  'profile trigger function is not executable by authenticated'
);
select is(
  (
    select prosecdef
    from pg_proc
    where oid = 'public.create_profile_for_user()'::regprocedure
  ),
  true,
  'profile trigger function remains security definer'
);
select is(
  (
    select proconfig
    from pg_proc
    where oid = 'public.create_profile_for_user()'::regprocedure
  ),
  array['search_path=""']::text[],
  'profile trigger function has an empty search path'
);

insert into auth.users (
  id,
  aud,
  role,
  email,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'authenticated',
    'authenticated',
    'security-user-a@wearit.test',
    '{"name":"User A"}',
    now(),
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'authenticated',
    'authenticated',
    'security-user-b@wearit.test',
    '{"name":"User B"}',
    now(),
    now()
  );

select is(
  (
    select count(*)
    from public.profiles
    where id in (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    )
  ),
  2::bigint,
  'auth user inserts create both profiles through the trigger'
);
select is(
  (
    select string_agg(display_name, ',' order by id)
    from public.profiles
    where id in (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    )
  ),
  'User A,User B',
  'profile trigger copies user display names'
);
select is(
  (
    select public
    from storage.buckets
    where id = 'wardrobe-assets'
  ),
  false,
  'wardrobe assets bucket is private'
);

insert into public.wardrobe_items (
  id,
  owner_id,
  name,
  category,
  slot,
  cutout_path
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '11111111-1111-4111-8111-111111111111',
    'User A item',
    'top',
    'top',
    '11111111-1111-4111-8111-111111111111/items/a.png'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    '22222222-2222-4222-8222-222222222222',
    'User B item',
    'coat',
    'outerwear',
    '22222222-2222-4222-8222-222222222222/items/b.png'
  );

insert into storage.objects (
  id,
  bucket_id,
  name,
  owner_id,
  metadata
)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  'wardrobe-assets',
  '22222222-2222-4222-8222-222222222222/items/b.png',
  '22222222-2222-4222-8222-222222222222',
  '{}'::jsonb
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select is(
  (
    select count(*)
    from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'
  ),
  1::bigint,
  'user A can see their own profile'
);
select is(
  (
    select count(*)
    from public.profiles
    where id = '22222222-2222-4222-8222-222222222222'
  ),
  0::bigint,
  'user A cannot see user B profile'
);
select is(
  pg_temp.affected_rows(
    $command$
      update public.profiles
      set display_name = 'User A updated'
      where id = '11111111-1111-4111-8111-111111111111'
    $command$
  ),
  1::bigint,
  'user A can update their own profile'
);
select is(
  pg_temp.affected_rows(
    $command$
      update public.profiles
      set display_name = 'User B compromised'
      where id = '22222222-2222-4222-8222-222222222222'
    $command$
  ),
  0::bigint,
  'user A cannot update user B profile'
);

select is(
  (
    select count(*)
    from public.wardrobe_items
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  1::bigint,
  'user A can see their own wardrobe item'
);
select is(
  (
    select count(*)
    from public.wardrobe_items
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ),
  0::bigint,
  'user A cannot see user B wardrobe item'
);
select is(
  pg_temp.affected_rows(
    $command$
      update public.wardrobe_items
      set name = 'User A item updated'
      where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    $command$
  ),
  1::bigint,
  'user A can update their own wardrobe item'
);
select is(
  pg_temp.affected_rows(
    $command$
      update public.wardrobe_items
      set name = 'User B item compromised'
      where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
    $command$
  ),
  0::bigint,
  'user A cannot update user B wardrobe item'
);
select is(
  pg_temp.sqlstate_for(
    $command$
      insert into public.wardrobe_items (
        owner_id,
        name,
        category,
        slot,
        cutout_path
      )
      values (
        '22222222-2222-4222-8222-222222222222',
        'Cross-owner item',
        'bottom',
        'bottom',
        '22222222-2222-4222-8222-222222222222/items/cross.png'
      )
    $command$
  ),
  '42501',
  'user A cannot insert an item owned by user B'
);
select is(
  pg_temp.sqlstate_for(
    $command$
      delete from public.profiles
      where id = '11111111-1111-4111-8111-111111111111'
    $command$
  ),
  '42501',
  'authenticated users cannot delete profile rows'
);
select is(
  pg_temp.sqlstate_for(
    $command$
      delete from public.wardrobe_items
      where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    $command$
  ),
  '42501',
  'authenticated users cannot delete wardrobe item rows'
);

select is(
  pg_temp.affected_rows(
    $command$
      insert into storage.objects (
        bucket_id,
        name,
        owner_id,
        metadata
      )
      values (
        'wardrobe-assets',
        '11111111-1111-4111-8111-111111111111/items/a.png',
        '11111111-1111-4111-8111-111111111111',
        '{}'::jsonb
      )
    $command$
  ),
  1::bigint,
  'user A can insert an asset in their own path'
);
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'wardrobe-assets'
      and name = '11111111-1111-4111-8111-111111111111/items/a.png'
  ),
  1::bigint,
  'user A can select an asset in their own path'
);
select is(
  pg_temp.affected_rows(
    $command$
      update storage.objects
      set metadata = jsonb_build_object('stage', 'updated')
      where bucket_id = 'wardrobe-assets'
        and name = '11111111-1111-4111-8111-111111111111/items/a.png'
    $command$
  ),
  1::bigint,
  'user A can update an asset in their own path'
);
select is(
  pg_temp.affected_rows(
    $command$
      update storage.objects
      set name = '11111111-1111-4111-8111-111111111111/items/a-moved.png'
      where bucket_id = 'wardrobe-assets'
        and name = '11111111-1111-4111-8111-111111111111/items/a.png'
    $command$
  ),
  1::bigint,
  'user A can move an asset within their own path'
);
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'wardrobe-assets'
      and name = '22222222-2222-4222-8222-222222222222/items/b.png'
  ),
  0::bigint,
  'user A cannot select user B asset'
);
select is(
  pg_temp.affected_rows(
    $command$
      update storage.objects
      set metadata = jsonb_build_object('stage', 'compromised')
      where bucket_id = 'wardrobe-assets'
        and name = '22222222-2222-4222-8222-222222222222/items/b.png'
    $command$
  ),
  0::bigint,
  'user A cannot update user B asset'
);

-- Supabase Storage enables direct deletion only internally after deleting object bytes.
-- Full DELETE execution belongs in later Storage API E2E coverage; verify its RLS policy here.
select is(
  (
    select cmd = 'DELETE'
      and roles = array['authenticated']::name[]
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'owners_delete_assets'
  ),
  true,
  'storage delete policy applies only to authenticated users'
);
select is(
  pg_temp.sqlstate_for(
    $command$
      insert into storage.objects (
        bucket_id,
        name,
        owner_id,
        metadata
      )
      values (
        'wardrobe-assets',
        '22222222-2222-4222-8222-222222222222/items/cross.png',
        '11111111-1111-4111-8111-111111111111',
        '{}'::jsonb
      )
    $command$
  ),
  '42501',
  'user A cannot insert an asset in user B path'
);
select is(
  pg_temp.sqlstate_for(
    $command$
      update storage.objects
      set name = '22222222-2222-4222-8222-222222222222/items/stolen.png'
      where bucket_id = 'wardrobe-assets'
        and name = '11111111-1111-4111-8111-111111111111/items/a-moved.png'
    $command$
  ),
  '42501',
  'user A cannot move an asset into user B path'
);
select is(
  (
    select position('bucket_id = ''wardrobe-assets''' in qual) > 0
      and position('storage.foldername(name)' in qual) > 0
      and position('auth.uid()' in qual) > 0
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'owners_delete_assets'
  ),
  true,
  'storage delete policy restricts bucket and first path segment to the owner'
);

select is(
  pg_temp.sqlstate_for('truncate table public.profiles cascade'),
  '42501',
  'authenticated users cannot truncate profile rows'
);
select is(
  pg_temp.sqlstate_for('truncate table public.wardrobe_items'),
  '42501',
  'authenticated users cannot truncate wardrobe item rows'
);

reset role;
select * from finish();
rollback;
