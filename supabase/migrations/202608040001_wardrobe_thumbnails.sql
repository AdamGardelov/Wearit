-- Small, private browsing derivatives for Wardrobe and Styling.
-- Full product images and mannequin wear layers remain authoritative and unchanged.

alter table public.wardrobe_items
  add column cutout_thumbnail_path text;

alter table public.wardrobe_item_images
  add column thumbnail_path text;

create unique index wardrobe_items_cutout_thumbnail_path_idx
  on public.wardrobe_items (cutout_thumbnail_path)
  where cutout_thumbnail_path is not null;

create unique index wardrobe_item_images_thumbnail_path_idx
  on public.wardrobe_item_images (thumbnail_path)
  where thumbnail_path is not null;

create or replace function public.set_wardrobe_item_thumbnails(
  p_item_id uuid,
  p_cutout_thumbnail_path text,
  p_image_thumbnails jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  thumbnail_prefix text;
  thumbnail_name text;
  rec record;
  seen_ids uuid[] := '{}';
  seen_paths text[] := '{}';
  saved_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select item.id into saved_id
  from public.wardrobe_items as item
  where item.id = p_item_id and item.owner_id = caller_id
  for update;

  if saved_id is null then
    raise exception 'The wardrobe item does not belong to the authenticated owner.' using errcode = '42501';
  end if;

  thumbnail_prefix := caller_id::text || '/items/' || p_item_id::text || '/thumbnails/';

  if p_cutout_thumbnail_path is not null then
    if left(p_cutout_thumbnail_path, char_length(thumbnail_prefix)) <> thumbnail_prefix then
      raise exception 'The wear thumbnail path must match the authenticated owner and item.' using errcode = '22023';
    end if;
    thumbnail_name := substring(p_cutout_thumbnail_path from char_length(thumbnail_prefix) + 1);
    if thumbnail_name = ''
       or position('/' in thumbnail_name) > 0
       or position(chr(92) in thumbnail_name) > 0
       or lower(coalesce(substring(thumbnail_name from '\.([^.]+)$'), '')) <> 'webp' then
      raise exception 'The wear thumbnail must be one WebP asset.' using errcode = '22023';
    end if;
  end if;

  if p_image_thumbnails is null or jsonb_typeof(p_image_thumbnails) <> 'array' then
    raise exception 'Product thumbnails must be an array.' using errcode = '22023';
  end if;

  for rec in
    select * from jsonb_to_recordset(p_image_thumbnails)
      as thumbnail(image_id uuid, thumbnail_path text)
  loop
    if rec.image_id is null or rec.thumbnail_path is null then
      raise exception 'Every product thumbnail needs an image id and path.' using errcode = '22023';
    end if;
    if left(rec.thumbnail_path, char_length(thumbnail_prefix)) <> thumbnail_prefix then
      raise exception 'Product thumbnail paths must match the authenticated owner and item.' using errcode = '22023';
    end if;
    thumbnail_name := substring(rec.thumbnail_path from char_length(thumbnail_prefix) + 1);
    if thumbnail_name = ''
       or position('/' in thumbnail_name) > 0
       or position(chr(92) in thumbnail_name) > 0
       or lower(coalesce(substring(thumbnail_name from '\.([^.]+)$'), '')) <> 'webp' then
      raise exception 'Each product thumbnail must be one WebP asset.' using errcode = '22023';
    end if;
    if rec.image_id = any(seen_ids) or rec.thumbnail_path = any(seen_paths) then
      raise exception 'Product thumbnail ids and paths must be unique.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.wardrobe_item_images as image
      where image.id = rec.image_id
        and image.wardrobe_item_id = p_item_id
        and image.owner_id = caller_id
    ) then
      raise exception 'A product thumbnail references an unknown item image.' using errcode = '22023';
    end if;
    seen_ids := seen_ids || rec.image_id;
    seen_paths := seen_paths || rec.thumbnail_path;
  end loop;

  update public.wardrobe_items
  set cutout_thumbnail_path = p_cutout_thumbnail_path,
      updated_at = now()
  where id = p_item_id and owner_id = caller_id;

  update public.wardrobe_item_images
  set thumbnail_path = null,
      updated_at = now()
  where wardrobe_item_id = p_item_id and owner_id = caller_id;

  update public.wardrobe_item_images as image
  set thumbnail_path = thumbnail.thumbnail_path,
      updated_at = now()
  from jsonb_to_recordset(p_image_thumbnails)
    as thumbnail(image_id uuid, thumbnail_path text)
  where image.id = thumbnail.image_id
    and image.wardrobe_item_id = p_item_id
    and image.owner_id = caller_id;

  return saved_id;
end;
$function$;

revoke execute on function public.set_wardrobe_item_thumbnails(uuid, text, jsonb)
  from PUBLIC, anon, authenticated;
grant execute on function public.set_wardrobe_item_thumbnails(uuid, text, jsonb)
  to authenticated;
