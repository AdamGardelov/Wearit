-- Owners can grant an existing Wearit user read-only access to their wardrobe.
-- Sharing covers garment metadata, categories, labels, and private garment assets.
-- Outfits, wear history, weekly plans, and every write operation remain owner-only.

create table public.wardrobe_guest_access (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  guest_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, guest_id),
  check (owner_id <> guest_id)
);

create index wardrobe_guest_access_guest_owner_idx
  on public.wardrobe_guest_access (guest_id, owner_id);

alter table public.wardrobe_guest_access enable row level security;

revoke all privileges on table public.wardrobe_guest_access from PUBLIC, anon, authenticated;

-- Keep policy expressions small and avoid exposing the access table itself. The
-- caller identity always comes from auth.uid(); callers cannot ask on behalf of
-- another guest.
create or replace function public.can_view_wardrobe(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_owner_id = auth.uid()
    or exists (
      select 1
      from public.wardrobe_guest_access as access
      where access.owner_id = p_owner_id
        and access.guest_id = auth.uid()
    );
$$;

-- Storage object names start with the owner's UUID. Keeping the comparison as
-- text makes malformed or unrelated object names safely return false instead of
-- raising a UUID cast error inside the Storage RLS policy.
create or replace function public.can_view_wardrobe_asset(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.wardrobe_guest_access as access
    where access.guest_id = auth.uid()
      and access.owner_id::text = split_part(p_object_name, '/', 1)
  );
$$;

create or replace function public.list_accessible_wardrobes()
returns table (
  owner_id uuid,
  display_name text,
  is_owner boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    coalesce(
      nullif(trim(profile.display_name), ''),
      nullif(split_part(account.email, '@', 1), ''),
      'Garderob'
    ) as display_name,
    profile.id = auth.uid() as is_owner
  from public.profiles as profile
  left join auth.users as account on account.id = profile.id
  where auth.uid() is not null
    and (
      profile.id = auth.uid()
      or exists (
        select 1
        from public.wardrobe_guest_access as access
        where access.owner_id = profile.id
          and access.guest_id = auth.uid()
      )
    )
  order by (profile.id = auth.uid()) desc, display_name, profile.id;
$$;

create or replace function public.list_wardrobe_guests()
returns table (
  guest_id uuid,
  display_name text,
  email text,
  granted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    guest.id,
    coalesce(
      nullif(trim(guest.display_name), ''),
      nullif(split_part(account.email, '@', 1), ''),
      'Gäst'
    ) as display_name,
    account.email,
    access.created_at
  from public.wardrobe_guest_access as access
  join public.profiles as guest on guest.id = access.guest_id
  left join auth.users as account on account.id = guest.id
  where access.owner_id = auth.uid()
  order by display_name, guest.id;
$$;

create or replace function public.grant_wardrobe_guest(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_guest_id uuid;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if p_email is null or trim(p_email) = '' then
    raise exception using errcode = '22023', message = 'Ange gästens e-postadress.';
  end if;

  select account.id
  into v_guest_id
  from auth.users as account
  where lower(account.email) = lower(trim(p_email));

  if v_guest_id is null then
    raise exception using errcode = 'P0002', message = 'Det finns inget Wearit-konto med den e-postadressen.';
  end if;

  if v_guest_id = v_owner_id then
    raise exception using errcode = '22023', message = 'Du har redan tillgång till din egen garderob.';
  end if;

  insert into public.wardrobe_guest_access (owner_id, guest_id)
  values (v_owner_id, v_guest_id)
  on conflict (owner_id, guest_id) do nothing;

  return v_guest_id;
end;
$$;

create or replace function public.revoke_wardrobe_guest(p_guest_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  delete from public.wardrobe_guest_access
  where owner_id = auth.uid()
    and guest_id = p_guest_id;
end;
$$;

revoke all on function public.can_view_wardrobe(uuid) from PUBLIC, anon, authenticated;
revoke all on function public.can_view_wardrobe_asset(text) from PUBLIC, anon, authenticated;
revoke all on function public.list_accessible_wardrobes() from PUBLIC, anon, authenticated;
revoke all on function public.list_wardrobe_guests() from PUBLIC, anon, authenticated;
revoke all on function public.grant_wardrobe_guest(text) from PUBLIC, anon, authenticated;
revoke all on function public.revoke_wardrobe_guest(uuid) from PUBLIC, anon, authenticated;

grant execute on function public.can_view_wardrobe(uuid) to authenticated;
grant execute on function public.can_view_wardrobe_asset(text) to authenticated;
grant execute on function public.list_accessible_wardrobes() to authenticated;
grant execute on function public.list_wardrobe_guests() to authenticated;
grant execute on function public.grant_wardrobe_guest(text) to authenticated;
grant execute on function public.revoke_wardrobe_guest(uuid) to authenticated;

create policy guests_select_items on public.wardrobe_items
for select to authenticated using (public.can_view_wardrobe(owner_id));

create policy guests_select_item_images on public.wardrobe_item_images
for select to authenticated using (public.can_view_wardrobe(owner_id));

create policy guests_select_categories on public.wardrobe_categories
for select to authenticated using (public.can_view_wardrobe(owner_id));

create policy guests_select_labels on public.wardrobe_labels
for select to authenticated using (public.can_view_wardrobe(owner_id));

create policy guests_select_item_labels on public.wardrobe_item_labels
for select to authenticated using (public.can_view_wardrobe(owner_id));

create policy guests_select_assets on storage.objects
for select to authenticated
using (
  bucket_id = 'wardrobe-assets'
  and public.can_view_wardrobe_asset(name)
);
