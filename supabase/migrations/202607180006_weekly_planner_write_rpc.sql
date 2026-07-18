-- Planning a weekday goes through a security-definer RPC, matching every other write in the app
-- (save_outfit, record_wear, delete_outfit, ...). A direct PostgREST upsert cannot be used: its
-- ON CONFLICT DO UPDATE rewrites every column in the request body, which would require UPDATE
-- privilege on owner_id and weekday. The planner deliberately keeps those immutable, so the write
-- runs as the definer and updates only the outfit and its timestamp.
create or replace function public.set_weekly_plan_slot(p_weekday integer, p_outfit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if p_weekday is null or p_weekday not between 1 and 5 then
    raise exception using errcode = '22023', message = 'A weekday between 1 and 5 is required.';
  end if;

  -- The composite foreign key already blocks another owner's outfit, but validate explicitly for
  -- a clear error instead of a raw constraint violation.
  if p_outfit_id is null or not exists (
    select 1
    from public.outfits as outfit
    where outfit.id = p_outfit_id
      and outfit.owner_id = v_owner_id
  ) then
    raise exception using errcode = '42501', message = 'The outfit is unavailable.';
  end if;

  insert into public.weekly_plan_slots (owner_id, weekday, outfit_id, updated_at)
  values (v_owner_id, p_weekday, p_outfit_id, now())
  on conflict (owner_id, weekday)
  do update set outfit_id = excluded.outfit_id, updated_at = now();
end;
$$;

revoke all on function public.set_weekly_plan_slot(integer, uuid) from public, anon, authenticated;
grant execute on function public.set_weekly_plan_slot(integer, uuid) to authenticated;
