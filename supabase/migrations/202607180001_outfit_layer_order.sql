-- Snapshot the composed layer order per outfit.
--
-- The original save_outfit copied each wardrobe item's default layer_order into
-- outfit_items. Dressing now owns an effective, user-controlled stack, so this
-- overload accepts one explicit layer value per selected item and persists it.
-- The four-argument function is left in place for backward compatibility.

create or replace function public.save_outfit(
  p_outfit_id uuid,
  p_name text,
  p_item_ids uuid[],
  p_layer_orders integer[],
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
  v_layer_count integer := coalesce(cardinality(p_layer_orders), 0);
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

  if v_layer_count <> v_item_count then
    raise exception using errcode = '22023', message = 'Each outfit item requires exactly one layer value.';
  end if;

  if (select count(distinct item_id) from unnest(p_item_ids) as selected(item_id)) <> v_item_count then
    raise exception using errcode = '22023', message = 'An outfit cannot contain duplicate items.';
  end if;

  if exists (
    select 1 from unnest(p_layer_orders) as layers(layer_order)
    where layer_order is null or layer_order not between 0 and 100
  ) then
    raise exception using errcode = '22023', message = 'Every layer value must be an integer from 0 to 100.';
  end if;

  if (select count(distinct layer_order) from unnest(p_layer_orders) as layers(layer_order)) <> v_layer_count then
    raise exception using errcode = '22023', message = 'Outfit layer values must be unique.';
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
    selected.layer_order
  from unnest(p_item_ids, p_layer_orders)
    with ordinality as selected(item_id, layer_order, position)
  join public.wardrobe_items as item
    on item.id = selected.item_id
   and item.owner_id = v_owner_id
  order by selected.position;

  return v_outfit_id;
end;
$$;

revoke all on function public.save_outfit(uuid, text, uuid[], integer[], text) from PUBLIC, anon, authenticated;
grant execute on function public.save_outfit(uuid, text, uuid[], integer[], text) to authenticated;
