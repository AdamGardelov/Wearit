create table public.outfits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  thumbnail_path text,
  needs_attention boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);

create table public.outfit_items (
  outfit_id uuid not null,
  wardrobe_item_id uuid not null,
  owner_id uuid not null,
  slot text not null check (slot in ('top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory')),
  layer_order integer not null check (layer_order between 0 and 100),
  primary key (outfit_id, wardrobe_item_id),
  unique (outfit_id, slot),
  foreign key (owner_id, outfit_id)
    references public.outfits(owner_id, id) on delete cascade,
  foreign key (owner_id, wardrobe_item_id)
    references public.wardrobe_items(owner_id, id)
);

create table public.wear_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  worn_at timestamptz not null,
  outfit_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, outfit_id)
    references public.outfits(owner_id, id)
);

create table public.wear_event_items (
  wear_event_id uuid not null,
  wardrobe_item_id uuid not null,
  owner_id uuid not null,
  primary key (wear_event_id, wardrobe_item_id),
  foreign key (owner_id, wear_event_id)
    references public.wear_events(owner_id, id) on delete cascade,
  foreign key (owner_id, wardrobe_item_id)
    references public.wardrobe_items(owner_id, id)
);

create index outfits_owner_updated_idx
on public.outfits (owner_id, updated_at desc);

create index outfit_items_owner_item_idx
on public.outfit_items (owner_id, wardrobe_item_id);

create index wear_events_owner_worn_idx
on public.wear_events (owner_id, worn_at desc);

create index wear_event_items_owner_item_idx
on public.wear_event_items (owner_id, wardrobe_item_id);

alter table public.outfits enable row level security;
alter table public.outfit_items enable row level security;
alter table public.wear_events enable row level security;
alter table public.wear_event_items enable row level security;

create policy owners_select_outfits on public.outfits
for select to authenticated using ((select auth.uid()) = owner_id);

create policy owners_select_outfit_items on public.outfit_items
for select to authenticated using ((select auth.uid()) = owner_id);

create policy owners_select_wear_events on public.wear_events
for select to authenticated using ((select auth.uid()) = owner_id);

create policy owners_select_wear_event_items on public.wear_event_items
for select to authenticated using ((select auth.uid()) = owner_id);

revoke all privileges on table
  public.outfits,
  public.outfit_items,
  public.wear_events,
  public.wear_event_items
from anon, authenticated;

grant select on table
  public.outfits,
  public.outfit_items,
  public.wear_events,
  public.wear_event_items
to authenticated;

create or replace function public.save_outfit(
  p_outfit_id uuid,
  p_name text,
  p_item_ids uuid[],
  p_thumbnail_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_outfit_id uuid := coalesce(p_outfit_id, gen_random_uuid());
  v_existing_owner_id uuid;
  v_thumbnail_path text := nullif(trim(p_thumbnail_path), '');
  v_item_count integer := coalesce(cardinality(p_item_ids), 0);
  v_available_count integer;
  v_slot_count integer;
  v_has_dress boolean;
  v_has_separates boolean;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if p_name is null or char_length(trim(p_name)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'An outfit name is required.';
  end if;

  if v_item_count < 2 then
    raise exception using errcode = '22023', message = 'An outfit must contain at least two items.';
  end if;

  if (select count(distinct item_id) from unnest(p_item_ids) as selected(item_id)) <> v_item_count then
    raise exception using errcode = '22023', message = 'An outfit cannot contain duplicate items.';
  end if;

  perform item.id
  from public.wardrobe_items as item
  where item.owner_id = v_owner_id
    and item.status = 'active'
    and item.id = any(p_item_ids)
  order by item.id
  for update;

  select
    count(*),
    count(distinct item.slot),
    coalesce(bool_or(item.slot = 'dress'), false),
    coalesce(bool_or(item.slot in ('top', 'bottom')), false)
  into v_available_count, v_slot_count, v_has_dress, v_has_separates
  from public.wardrobe_items as item
  where item.owner_id = v_owner_id
    and item.status = 'active'
    and item.id = any(p_item_ids);

  if v_available_count <> v_item_count then
    raise exception using errcode = '22023', message = 'Every outfit item must be an active item owned by the caller.';
  end if;

  if v_slot_count <> v_item_count then
    raise exception using errcode = '22023', message = 'An outfit cannot contain more than one item per slot.';
  end if;

  if v_has_dress and v_has_separates then
    raise exception using errcode = '22023', message = 'A dress cannot be combined with a top or bottom.';
  end if;

  if v_thumbnail_path is not null
    and v_thumbnail_path !~ (
      '^' || v_owner_id::text || '/outfits/' || v_outfit_id::text
      || '/thumbnail-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
    )
  then
    raise exception using errcode = '22023', message = 'The outfit thumbnail path is invalid.';
  end if;

  if p_outfit_id is null then
    insert into public.outfits (id, owner_id, name, thumbnail_path)
    values (v_outfit_id, v_owner_id, trim(p_name), v_thumbnail_path);
  else
    select outfit.owner_id
    into v_existing_owner_id
    from public.outfits as outfit
    where outfit.id = v_outfit_id
    for update;

    if v_existing_owner_id is null then
      insert into public.outfits (id, owner_id, name, thumbnail_path)
      values (v_outfit_id, v_owner_id, trim(p_name), v_thumbnail_path);
    elsif v_existing_owner_id <> v_owner_id then
      raise exception using errcode = '42501', message = 'The outfit is unavailable.';
    else
      update public.outfits
      set
        name = trim(p_name),
        thumbnail_path = v_thumbnail_path,
        needs_attention = false,
        updated_at = now()
      where id = v_outfit_id
        and owner_id = v_owner_id;

      delete from public.outfit_items
      where outfit_id = v_outfit_id
        and owner_id = v_owner_id;
    end if;
  end if;

  insert into public.outfit_items (
    outfit_id,
    wardrobe_item_id,
    owner_id,
    slot,
    layer_order
  )
  select
    v_outfit_id,
    item.id,
    v_owner_id,
    item.slot,
    item.layer_order
  from unnest(p_item_ids) with ordinality as selected(item_id, position)
  join public.wardrobe_items as item
    on item.id = selected.item_id
   and item.owner_id = v_owner_id
  order by selected.position;

  return v_outfit_id;
end;
$$;

create or replace function public.record_wear(
  p_item_ids uuid[],
  p_worn_at timestamptz,
  p_outfit_id uuid,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_wear_event_id uuid;
  v_item_count integer := coalesce(cardinality(p_item_ids), 0);
  v_available_count integer;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if v_item_count < 1 then
    raise exception using errcode = '22023', message = 'A wear event must contain at least one item.';
  end if;

  if p_worn_at is null then
    raise exception using errcode = '22023', message = 'A worn date is required.';
  end if;

  if (select count(distinct item_id) from unnest(p_item_ids) as selected(item_id)) <> v_item_count then
    raise exception using errcode = '22023', message = 'A wear event cannot contain duplicate items.';
  end if;

  perform item.id
  from public.wardrobe_items as item
  where item.owner_id = v_owner_id
    and item.status = 'active'
    and item.id = any(p_item_ids)
  order by item.id
  for update;

  select count(*)
  into v_available_count
  from public.wardrobe_items as item
  where item.owner_id = v_owner_id
    and item.status = 'active'
    and item.id = any(p_item_ids);

  if v_available_count <> v_item_count then
    raise exception using errcode = '22023', message = 'Every wear item must be an active item owned by the caller.';
  end if;

  if p_outfit_id is not null and not exists (
    select 1
    from public.outfits as outfit
    where outfit.id = p_outfit_id
      and outfit.owner_id = v_owner_id
  ) then
    raise exception using errcode = '42501', message = 'The outfit is unavailable.';
  end if;

  insert into public.wear_events (owner_id, worn_at, outfit_id, notes)
  values (v_owner_id, p_worn_at, p_outfit_id, nullif(trim(p_notes), ''))
  returning id into v_wear_event_id;

  insert into public.wear_event_items (wear_event_id, wardrobe_item_id, owner_id)
  select v_wear_event_id, selected.item_id, v_owner_id
  from unnest(p_item_ids) with ordinality as selected(item_id, position)
  order by selected.position;

  return v_wear_event_id;
end;
$$;

create or replace function public.archive_wardrobe_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_archived_item_id uuid;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  update public.wardrobe_items
  set
    status = 'archived',
    archived_at = now(),
    updated_at = now()
  where id = p_item_id
    and owner_id = v_owner_id
    and status = 'active'
  returning id into v_archived_item_id;

  if v_archived_item_id is null then
    raise exception using errcode = '42501', message = 'The wardrobe item is unavailable.';
  end if;

  update public.outfits as outfit
  set
    needs_attention = true,
    updated_at = now()
  where outfit.owner_id = v_owner_id
    and exists (
      select 1
      from public.outfit_items as item
      where item.outfit_id = outfit.id
        and item.owner_id = outfit.owner_id
        and item.wardrobe_item_id = v_archived_item_id
    );
end;
$$;

revoke all on function public.save_outfit(uuid, text, uuid[], text) from PUBLIC, anon, authenticated;
revoke all on function public.record_wear(uuid[], timestamptz, uuid, text) from PUBLIC, anon, authenticated;
revoke all on function public.archive_wardrobe_item(uuid) from PUBLIC, anon, authenticated;

grant execute on function public.save_outfit(uuid, text, uuid[], text) to authenticated;
grant execute on function public.record_wear(uuid[], timestamptz, uuid, text) to authenticated;
grant execute on function public.archive_wardrobe_item(uuid) to authenticated;

create view public.wardrobe_item_last_worn
with (security_invoker = true)
as
select
  item.owner_id,
  item.wardrobe_item_id,
  max(event.worn_at) as last_worn_at
from public.wear_event_items as item
join public.wear_events as event
  on event.owner_id = item.owner_id
 and event.id = item.wear_event_id
group by item.owner_id, item.wardrobe_item_id;

revoke all privileges on table public.wardrobe_item_last_worn from anon, authenticated;
grant select on table public.wardrobe_item_last_worn to authenticated;

revoke update on table public.wardrobe_items from authenticated;
grant update (
  name,
  category,
  slot,
  brand,
  size,
  notes,
  colors,
  tags,
  anchor_x,
  anchor_y,
  scale,
  rotation_degrees,
  layer_order,
  updated_at
) on public.wardrobe_items to authenticated;
