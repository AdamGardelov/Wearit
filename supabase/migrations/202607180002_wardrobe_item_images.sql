-- Structured product images for wardrobe items.
--
-- Product photos (front / back / detail) are browsable assets kept separate from
-- the single transparent mannequin "wear layer" stored in wardrobe_items.cutout_path.
-- Owners can only read their rows; the v2 import RPC owns all writes.

create table public.wardrobe_item_images (
  id uuid primary key,
  owner_id uuid not null,
  wardrobe_item_id uuid not null,
  storage_path text not null,
  view text not null check (view in ('front', 'back', 'detail')),
  sort_order integer not null check (sort_order >= 0),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (storage_path),
  unique (wardrobe_item_id, sort_order),
  check (is_primary = false or view = 'front'),
  foreign key (owner_id, wardrobe_item_id)
    references public.wardrobe_items(owner_id, id) on delete cascade
);

-- At most one primary image, and at most one front and one back, per item.
create unique index wardrobe_item_images_one_primary_idx
  on public.wardrobe_item_images (wardrobe_item_id) where is_primary;
create unique index wardrobe_item_images_single_view_idx
  on public.wardrobe_item_images (wardrobe_item_id, view) where view in ('front', 'back');
create index wardrobe_item_images_owner_item_idx
  on public.wardrobe_item_images (owner_id, wardrobe_item_id, sort_order);

alter table public.wardrobe_item_images enable row level security;

create policy owners_select_item_images on public.wardrobe_item_images
for select to authenticated using ((select auth.uid()) = owner_id);

revoke all privileges on table public.wardrobe_item_images from anon, authenticated;
grant select on table public.wardrobe_item_images to authenticated;

-- Version 2 import: atomically upsert the item, restore it if archived, and replace
-- its structured product images. The wear layer stays in wardrobe_items.cutout_path.
create or replace function public.import_wardrobe_item_v2(
  p_item_id uuid,
  p_name text,
  p_category text,
  p_slot text,
  p_colors text[],
  p_tags text[],
  p_wear_layer_path text,
  p_images jsonb,
  p_anchor_x double precision,
  p_anchor_y double precision,
  p_scale double precision,
  p_rotation_degrees double precision,
  p_layer_order integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  wear_prefix text;
  images_prefix text;
  wear_name text;
  image_name text;
  image_ext text;
  rec record;
  primary_count integer := 0;
  front_count integer := 0;
  back_count integer := 0;
  seen_ids uuid[] := '{}';
  seen_paths text[] := '{}';
  seen_orders integer[] := '{}';
  saved_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_item_id is null then
    raise exception 'A stable wardrobe item ID is required.' using errcode = '22023';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 120 then
    raise exception 'The item name must contain 1 to 120 characters.' using errcode = '22023';
  end if;
  if public.wardrobe_slot_for_category(p_category) is null
     or p_slot is distinct from public.wardrobe_slot_for_category(p_category) then
    raise exception 'The category and slot do not match.' using errcode = '22023';
  end if;
  if p_anchor_x is null or p_anchor_x not between 0 and 1
     or p_anchor_y is null or p_anchor_y not between 0 and 1
     or p_scale is null or p_scale not between 0.05 and 2
     or p_rotation_degrees is null or p_rotation_degrees not between -180 and 180
     or p_layer_order is null or p_layer_order not between 0 and 100 then
    raise exception 'The reviewed placement is outside its allowed bounds.' using errcode = '22023';
  end if;

  wear_prefix := caller_id::text || '/items/' || p_item_id::text || '/wear-layer/';
  if p_wear_layer_path is null
     or left(p_wear_layer_path, char_length(wear_prefix)) <> wear_prefix then
    raise exception 'The wear-layer path must match the authenticated owner and item.' using errcode = '22023';
  end if;
  wear_name := substring(p_wear_layer_path from char_length(wear_prefix) + 1);
  if wear_name = ''
     or position('/' in wear_name) > 0
     or position(chr(92) in wear_name) > 0
     or lower(coalesce(substring(wear_name from '\.([^.]+)$'), '')) <> 'png' then
    raise exception 'The wear layer must be a single PNG asset.' using errcode = '22023';
  end if;

  if p_images is null or jsonb_typeof(p_images) <> 'array' or jsonb_array_length(p_images) < 1 then
    raise exception 'At least one product image is required.' using errcode = '22023';
  end if;

  images_prefix := caller_id::text || '/items/' || p_item_id::text || '/images/';
  for rec in
    select * from jsonb_to_recordset(p_images)
      as img(id uuid, storage_path text, view text, sort_order integer, is_primary boolean)
  loop
    if rec.id is null or rec.storage_path is null or rec.view is null
       or rec.sort_order is null or rec.is_primary is null then
      raise exception 'Every product image needs an id, path, view, sort order, and primary flag.' using errcode = '22023';
    end if;
    if rec.view not in ('front', 'back', 'detail') then
      raise exception 'A product image view must be front, back, or detail.' using errcode = '22023';
    end if;
    if rec.sort_order < 0 then
      raise exception 'Product image sort orders must be zero or greater.' using errcode = '22023';
    end if;
    if left(rec.storage_path, char_length(images_prefix)) <> images_prefix then
      raise exception 'Product image paths must match the authenticated owner and item.' using errcode = '22023';
    end if;
    image_name := substring(rec.storage_path from char_length(images_prefix) + 1);
    if image_name = ''
       or position('/' in image_name) > 0
       or position(chr(92) in image_name) > 0 then
      raise exception 'Product image paths must contain one non-traversing asset name.' using errcode = '22023';
    end if;
    image_ext := lower(coalesce(substring(image_name from '\.([^.]+)$'), ''));
    if image_ext not in ('webp', 'png', 'jpg', 'jpeg') then
      raise exception 'Product images must be webp, png, or jpg derivatives.' using errcode = '22023';
    end if;
    if rec.is_primary then
      primary_count := primary_count + 1;
      if rec.view <> 'front' then
        raise exception 'The primary product image must be the front image.' using errcode = '22023';
      end if;
    end if;
    if rec.view = 'front' then front_count := front_count + 1; end if;
    if rec.view = 'back' then back_count := back_count + 1; end if;
    if rec.id = any(seen_ids) then
      raise exception 'Product image IDs must be unique.' using errcode = '22023';
    end if;
    if rec.storage_path = any(seen_paths) then
      raise exception 'Product image paths must be unique.' using errcode = '22023';
    end if;
    if rec.sort_order = any(seen_orders) then
      raise exception 'Product image sort orders must be unique.' using errcode = '22023';
    end if;
    seen_ids := seen_ids || rec.id;
    seen_paths := seen_paths || rec.storage_path;
    seen_orders := seen_orders || rec.sort_order;
  end loop;

  if primary_count <> 1 then
    raise exception 'Exactly one product image must be primary.' using errcode = '22023';
  end if;
  if front_count <> 1 then
    raise exception 'A version 2 item requires exactly one front image.' using errcode = '22023';
  end if;
  if back_count > 1 then
    raise exception 'A version 2 item may have at most one back image.' using errcode = '22023';
  end if;

  insert into public.wardrobe_items as wardrobe_item (
    id, owner_id, name, category, slot, colors, tags,
    cutout_path, detail_image_paths,
    anchor_x, anchor_y, scale, rotation_degrees, layer_order, status
  )
  values (
    p_item_id, caller_id, trim(p_name), p_category, p_slot,
    coalesce(p_colors, '{}'::text[]), coalesce(p_tags, '{}'::text[]),
    p_wear_layer_path, '{}'::text[],
    p_anchor_x, p_anchor_y, p_scale, p_rotation_degrees, p_layer_order, 'active'
  )
  on conflict (id) do update
  set
    name = excluded.name,
    category = excluded.category,
    slot = excluded.slot,
    colors = excluded.colors,
    tags = excluded.tags,
    cutout_path = excluded.cutout_path,
    anchor_x = excluded.anchor_x,
    anchor_y = excluded.anchor_y,
    scale = excluded.scale,
    rotation_degrees = excluded.rotation_degrees,
    layer_order = excluded.layer_order,
    status = 'active',
    archived_at = null,
    updated_at = now()
  where wardrobe_item.owner_id = caller_id
  returning wardrobe_item.id into saved_id;

  if saved_id is null then
    raise exception 'The stable wardrobe item ID belongs to another owner.' using errcode = '42501';
  end if;

  delete from public.wardrobe_item_images
  where wardrobe_item_id = p_item_id and owner_id = caller_id;

  insert into public.wardrobe_item_images (
    id, owner_id, wardrobe_item_id, storage_path, view, sort_order, is_primary
  )
  select img.id, caller_id, p_item_id, img.storage_path, img.view, img.sort_order, img.is_primary
  from jsonb_to_recordset(p_images)
    as img(id uuid, storage_path text, view text, sort_order integer, is_primary boolean);

  -- Re-importing restores an archived item, so referencing outfits recompute whether
  -- they still contain any archived garment.
  update public.outfits as outfit
  set
    needs_attention = exists (
      select 1
      from public.outfit_items as outfit_item
      join public.wardrobe_items as member
        on member.id = outfit_item.wardrobe_item_id
       and member.owner_id = outfit_item.owner_id
      where outfit_item.outfit_id = outfit.id
        and outfit_item.owner_id = outfit.owner_id
        and member.status = 'archived'
    ),
    updated_at = now()
  where outfit.owner_id = caller_id
    and exists (
      select 1
      from public.outfit_items as referencing
      where referencing.outfit_id = outfit.id
        and referencing.owner_id = outfit.owner_id
        and referencing.wardrobe_item_id = p_item_id
    );

  return saved_id;
end;
$function$;

revoke execute on function public.import_wardrobe_item_v2(
  uuid, text, text, text, text[], text[], text, jsonb,
  double precision, double precision, double precision, double precision, integer
) from PUBLIC, anon, authenticated;
grant execute on function public.import_wardrobe_item_v2(
  uuid, text, text, text, text[], text[], text, jsonb,
  double precision, double precision, double precision, double precision, integer
) to authenticated;
