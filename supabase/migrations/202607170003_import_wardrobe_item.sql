create or replace function public.import_wardrobe_item(
  p_item_id uuid,
  p_name text,
  p_category text,
  p_slot text,
  p_colors text[],
  p_tags text[],
  p_cutout_path text,
  p_detail_image_paths text[],
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
  expected_cutout_path text;
  detail_prefix text;
  detail_path text;
  detail_name text;
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

  expected_cutout_path := caller_id::text || '/items/' || p_item_id::text || '/cutout.png';
  if p_cutout_path is distinct from expected_cutout_path then
    raise exception 'The cutout path must match the authenticated owner and stable item ID.' using errcode = '22023';
  end if;

  detail_prefix := caller_id::text || '/items/' || p_item_id::text || '/details/';
  if coalesce(cardinality(p_detail_image_paths), 0) <> (
    select count(distinct path)
    from unnest(coalesce(p_detail_image_paths, '{}'::text[])) as paths(path)
  ) then
    raise exception 'Detail paths must be unique.' using errcode = '22023';
  end if;
  foreach detail_path in array coalesce(p_detail_image_paths, '{}'::text[]) loop
    if detail_path is null or left(detail_path, char_length(detail_prefix)) <> detail_prefix then
      raise exception 'Every detail path must match the authenticated owner and stable item ID.' using errcode = '22023';
    end if;
    detail_name := substring(detail_path from char_length(detail_prefix) + 1);
    if detail_name = ''
       or detail_name in ('.', '..')
       or position('/' in detail_name) > 0
       or position(chr(92) in detail_name) > 0 then
      raise exception 'Detail paths must contain one non-traversing asset name.' using errcode = '22023';
    end if;
  end loop;

  insert into public.wardrobe_items as wardrobe_item (
    id,
    owner_id,
    name,
    category,
    slot,
    colors,
    tags,
    cutout_path,
    detail_image_paths,
    anchor_x,
    anchor_y,
    scale,
    rotation_degrees,
    layer_order,
    status
  )
  values (
    p_item_id,
    caller_id,
    trim(p_name),
    p_category,
    p_slot,
    coalesce(p_colors, '{}'::text[]),
    coalesce(p_tags, '{}'::text[]),
    p_cutout_path,
    coalesce(p_detail_image_paths, '{}'::text[]),
    p_anchor_x,
    p_anchor_y,
    p_scale,
    p_rotation_degrees,
    p_layer_order,
    'active'
  )
  on conflict (id) do update
  set
    name = excluded.name,
    category = excluded.category,
    slot = excluded.slot,
    colors = excluded.colors,
    tags = excluded.tags,
    cutout_path = excluded.cutout_path,
    detail_image_paths = excluded.detail_image_paths,
    anchor_x = excluded.anchor_x,
    anchor_y = excluded.anchor_y,
    scale = excluded.scale,
    rotation_degrees = excluded.rotation_degrees,
    layer_order = excluded.layer_order,
    updated_at = now()
  where wardrobe_item.owner_id = caller_id
  returning wardrobe_item.id into saved_id;

  if saved_id is null then
    raise exception 'The stable wardrobe item ID belongs to another owner.' using errcode = '42501';
  end if;
  return saved_id;
end;
$function$;

revoke execute on function public.import_wardrobe_item(
  uuid, text, text, text, text[], text[], text, text[],
  double precision, double precision, double precision, double precision, integer
) from PUBLIC, anon, authenticated;
grant execute on function public.import_wardrobe_item(
  uuid, text, text, text, text[], text[], text, text[],
  double precision, double precision, double precision, double precision, integer
) to authenticated;
