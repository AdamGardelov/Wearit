-- Deleting a saved outfit. outfit_items and outfit_labels cascade from the outfits row,
-- but wear_events.outfit_id is a RESTRICT reference, so it is detached (set null) first to
-- preserve the wear history itself. Runs security definer with an empty search_path and is
-- scoped to the caller's own rows; returns the thumbnail path so the client can clean up
-- the stored asset.
create or replace function public.delete_outfit(p_outfit_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_thumbnail_path text;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  select o.thumbnail_path
  into v_thumbnail_path
  from public.outfits as o
  where o.owner_id = v_owner_id and o.id = p_outfit_id;

  -- FOUND is the reliable signal here: the thumbnail path itself is nullable, so its value
  -- cannot distinguish "no such outfit" from "outfit without a thumbnail".
  if not found then
    raise exception using errcode = 'P0002', message = 'Outfit not found.';
  end if;

  -- Keep the wear history; only sever its link to the outfit being removed.
  update public.wear_events
  set outfit_id = null
  where owner_id = v_owner_id and outfit_id = p_outfit_id;

  delete from public.outfits
  where owner_id = v_owner_id and id = p_outfit_id;

  return v_thumbnail_path;
end;
$$;

revoke all on function public.delete_outfit(uuid) from PUBLIC, anon, authenticated;
grant execute on function public.delete_outfit(uuid) to authenticated;
