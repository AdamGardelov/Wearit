-- Owner-scoped season and theme labels for clothes and saved outfits.
--
-- Four locked seasons are seeded for every owner; owners create their own themes.
-- Assignments live in owner-scoped join tables whose composite foreign keys make a
-- cross-owner assignment structurally impossible even inside privileged functions.

create table public.wardrobe_labels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('season', 'theme')),
  season_key text,
  name text not null check (name = trim(name) and char_length(name) between 1 and 80),
  normalized_name text generated always as (lower(trim(name))) stored,
  locked boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, season_key),
  check (
    (kind = 'season' and season_key in ('spring', 'summer', 'autumn', 'winter') and locked)
    or (kind = 'theme' and season_key is null and not locked)
  )
);

create unique index wardrobe_labels_owner_theme_name_key
  on public.wardrobe_labels (owner_id, normalized_name)
  where kind = 'theme';

create table public.wardrobe_item_labels (
  owner_id uuid not null,
  wardrobe_item_id uuid not null,
  label_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (wardrobe_item_id, label_id),
  foreign key (owner_id, wardrobe_item_id)
    references public.wardrobe_items(owner_id, id) on delete cascade,
  foreign key (owner_id, label_id)
    references public.wardrobe_labels(owner_id, id) on delete cascade
);

create index wardrobe_item_labels_owner_label_idx
  on public.wardrobe_item_labels (owner_id, label_id);

create table public.outfit_labels (
  owner_id uuid not null,
  outfit_id uuid not null,
  label_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (outfit_id, label_id),
  foreign key (owner_id, outfit_id)
    references public.outfits(owner_id, id) on delete cascade,
  foreign key (owner_id, label_id)
    references public.wardrobe_labels(owner_id, id) on delete cascade
);

create index outfit_labels_owner_label_idx
  on public.outfit_labels (owner_id, label_id);

alter table public.wardrobe_labels enable row level security;
alter table public.wardrobe_item_labels enable row level security;
alter table public.outfit_labels enable row level security;

create policy owners_select_labels on public.wardrobe_labels
for select to authenticated using ((select auth.uid()) = owner_id);
create policy owners_insert_themes on public.wardrobe_labels
for insert to authenticated
with check (
  (select auth.uid()) = owner_id and kind = 'theme' and season_key is null and locked = false
);
create policy owners_update_themes on public.wardrobe_labels
for update to authenticated
using ((select auth.uid()) = owner_id and kind = 'theme' and locked = false)
with check (
  (select auth.uid()) = owner_id and kind = 'theme' and season_key is null and locked = false
);
create policy owners_delete_themes on public.wardrobe_labels
for delete to authenticated
using ((select auth.uid()) = owner_id and kind = 'theme' and locked = false);

create policy owners_select_item_labels on public.wardrobe_item_labels
for select to authenticated using ((select auth.uid()) = owner_id);
create policy owners_select_outfit_labels on public.outfit_labels
for select to authenticated using ((select auth.uid()) = owner_id);

revoke all privileges on table
  public.wardrobe_labels,
  public.wardrobe_item_labels,
  public.outfit_labels
from anon, authenticated;

grant select on table
  public.wardrobe_labels,
  public.wardrobe_item_labels,
  public.outfit_labels
to authenticated;
grant insert, delete on table public.wardrobe_labels to authenticated;
grant update (name, updated_at) on table public.wardrobe_labels to authenticated;

-- Seed the four locked seasons for every existing profile.
insert into public.wardrobe_labels (owner_id, kind, season_key, name, locked)
select profile.id, 'season', season.season_key, season.name, true
from public.profiles as profile
cross join (values
  ('spring', 'Spring'),
  ('summer', 'Summer'),
  ('autumn', 'Autumn'),
  ('winter', 'Winter')
) as season(season_key, name)
on conflict (owner_id, season_key) do nothing;

-- Replace the profile trigger so future owners receive their four seasons in the
-- same transaction. Behaviour, security definer, empty search_path, and revokes
-- are copied from 202607170001 unchanged apart from the season seed.
create or replace function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;

  insert into public.wardrobe_labels (owner_id, kind, season_key, name, locked)
  select new.id, 'season', season.season_key, season.name, true
  from (values
    ('spring', 'Spring'),
    ('summer', 'Summer'),
    ('autumn', 'Autumn'),
    ('winter', 'Winter')
  ) as season(season_key, name)
  on conflict (owner_id, season_key) do nothing;

  return new;
end;
$$;

revoke execute on function public.create_profile_for_user() from PUBLIC, anon, authenticated;

-- Atomically update editable item metadata and replace the item's label assignment.
create or replace function public.update_wardrobe_item_with_labels(
  p_item_id uuid,
  p_name text,
  p_category text,
  p_slot text,
  p_brand text,
  p_size text,
  p_notes text,
  p_colors text[],
  p_tags text[],
  p_anchor_x double precision,
  p_anchor_y double precision,
  p_scale double precision,
  p_rotation_degrees double precision,
  p_layer_order integer,
  p_label_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_label_ids uuid[] := coalesce(p_label_ids, '{}'::uuid[]);
  v_distinct_labels integer := (select count(distinct id) from unnest(v_label_ids) as ids(id));
  v_item_id uuid;
  v_owned_labels integer;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if v_distinct_labels <> coalesce(cardinality(v_label_ids), 0) then
    raise exception using errcode = '22023', message = 'Labels must be unique.';
  end if;

  select item.id into v_item_id
  from public.wardrobe_items as item
  where item.id = p_item_id and item.owner_id = v_owner_id
  for update;
  if v_item_id is null then
    raise exception using errcode = '42501', message = 'The wardrobe item is unavailable.';
  end if;

  select count(*) into v_owned_labels
  from public.wardrobe_labels as label
  where label.owner_id = v_owner_id and label.id = any(v_label_ids);
  if v_owned_labels <> v_distinct_labels then
    raise exception using errcode = '22023', message = 'Every label must belong to the caller.';
  end if;

  update public.wardrobe_items
  set
    name = p_name,
    category = p_category,
    slot = p_slot,
    brand = p_brand,
    size = p_size,
    notes = p_notes,
    colors = coalesce(p_colors, '{}'::text[]),
    tags = coalesce(p_tags, '{}'::text[]),
    anchor_x = p_anchor_x,
    anchor_y = p_anchor_y,
    scale = p_scale,
    rotation_degrees = p_rotation_degrees,
    layer_order = p_layer_order,
    updated_at = now()
  where id = p_item_id and owner_id = v_owner_id;

  delete from public.wardrobe_item_labels
  where wardrobe_item_id = p_item_id and owner_id = v_owner_id;

  insert into public.wardrobe_item_labels (owner_id, wardrobe_item_id, label_id)
  select v_owner_id, p_item_id, ids.id from unnest(v_label_ids) as ids(id);

  return p_item_id;
end;
$$;

-- Save an outfit and its labels atomically by reusing save_outfit for all existing
-- item/slot/layer/thumbnail/ownership validation, then replacing outfit_labels.
create or replace function public.save_outfit_with_labels(
  p_outfit_id uuid,
  p_name text,
  p_item_ids uuid[],
  p_layer_orders integer[],
  p_thumbnail_path text,
  p_label_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_label_ids uuid[] := coalesce(p_label_ids, '{}'::uuid[]);
  v_distinct_labels integer := (select count(distinct id) from unnest(v_label_ids) as ids(id));
  v_owned_labels integer;
  v_outfit_id uuid;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if v_distinct_labels <> coalesce(cardinality(v_label_ids), 0) then
    raise exception using errcode = '22023', message = 'Labels must be unique.';
  end if;

  select count(*) into v_owned_labels
  from public.wardrobe_labels as label
  where label.owner_id = v_owner_id and label.id = any(v_label_ids);
  if v_owned_labels <> v_distinct_labels then
    raise exception using errcode = '22023', message = 'Every label must belong to the caller.';
  end if;

  v_outfit_id := public.save_outfit(
    p_outfit_id,
    p_name,
    p_item_ids,
    p_layer_orders,
    p_thumbnail_path
  );

  delete from public.outfit_labels
  where outfit_id = v_outfit_id and owner_id = v_owner_id;

  insert into public.outfit_labels (owner_id, outfit_id, label_id)
  select v_owner_id, v_outfit_id, ids.id from unnest(v_label_ids) as ids(id);

  return v_outfit_id;
end;
$$;

revoke all on function public.update_wardrobe_item_with_labels(
  uuid, text, text, text, text, text, text, text[], text[],
  double precision, double precision, double precision, double precision, integer, uuid[]
) from PUBLIC, anon, authenticated;
grant execute on function public.update_wardrobe_item_with_labels(
  uuid, text, text, text, text, text, text, text[], text[],
  double precision, double precision, double precision, double precision, integer, uuid[]
) to authenticated;

revoke all on function public.save_outfit_with_labels(
  uuid, text, uuid[], integer[], text, uuid[]
) from PUBLIC, anon, authenticated;
grant execute on function public.save_outfit_with_labels(
  uuid, text, uuid[], integer[], text, uuid[]
) to authenticated;
