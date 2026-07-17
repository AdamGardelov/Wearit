create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.create_profile_for_user() from PUBLIC, anon, authenticated;

create trigger auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_user();

create or replace function public.wardrobe_slot_for_category(category text)
returns text language sql immutable set search_path = ''
as $$
  select case category
    when 'top' then 'top'
    when 'bottom' then 'bottom'
    when 'dress' then 'dress'
    when 'jacket' then 'outerwear'
    when 'coat' then 'outerwear'
    when 'shoes' then 'shoes'
    when 'accessory' then 'accessory'
    else null
  end;
$$;

create table public.wardrobe_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  category text not null check (category in ('top', 'bottom', 'dress', 'jacket', 'coat', 'shoes', 'accessory')),
  slot text not null check (slot in ('top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory')),
  brand text,
  size text,
  notes text,
  colors text[] not null default '{}',
  tags text[] not null default '{}',
  cutout_path text not null,
  detail_image_paths text[] not null default '{}',
  anchor_x double precision not null default 0.5 check (anchor_x between 0 and 1),
  anchor_y double precision not null default 0.5 check (anchor_y between 0 and 1),
  scale double precision not null default 0.5 check (scale between 0.05 and 2),
  rotation_degrees double precision not null default 0 check (rotation_degrees between -180 and 180),
  layer_order integer not null default 30 check (layer_order between 0 and 100),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (owner_id, id),
  check (slot = public.wardrobe_slot_for_category(category)),
  check ((status = 'archived') = (archived_at is not null))
);

create index wardrobe_items_owner_status_idx
on public.wardrobe_items (owner_id, status, created_at desc);

alter table public.profiles enable row level security;
alter table public.wardrobe_items enable row level security;

create policy owners_select_profile on public.profiles
for select to authenticated using ((select auth.uid()) = id);
create policy owners_update_profile on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy owners_select_items on public.wardrobe_items
for select to authenticated using ((select auth.uid()) = owner_id);
create policy owners_insert_items on public.wardrobe_items
for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy owners_update_items on public.wardrobe_items
for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

revoke all privileges on table public.profiles, public.wardrobe_items from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.wardrobe_items to authenticated;

insert into storage.buckets (id, name, public)
values ('wardrobe-assets', 'wardrobe-assets', false)
on conflict (id) do update set public = false;

create policy owners_select_assets on storage.objects
for select to authenticated
using (
  bucket_id = 'wardrobe-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy owners_insert_assets on storage.objects
for insert to authenticated
with check (
  bucket_id = 'wardrobe-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy owners_update_assets on storage.objects
for update to authenticated
using (
  bucket_id = 'wardrobe-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'wardrobe-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy owners_delete_assets on storage.objects
for delete to authenticated
using (
  bucket_id = 'wardrobe-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
