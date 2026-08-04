-- Add the remaining built-in categories after the owner-scoped custom-category
-- migration. Do not restore the former fixed category check: custom category IDs
-- are UUID strings and are validated by wardrobe_items_category_slot_validation.

alter table public.outfit_items drop constraint if exists outfit_items_slot_check;
alter table public.wardrobe_items drop constraint if exists wardrobe_items_slot_check;
alter table public.wardrobe_categories drop constraint if exists wardrobe_categories_slot_check;

create or replace function public.wardrobe_slot_for_category(category text)
returns text language sql immutable set search_path = ''
as $$
  select case category
    when 'top' then 'top' when 'bottom' then 'bottom' when 'dress' then 'dress'
    when 'jacket' then 'outerwear' when 'coat' then 'outerwear' when 'shoes' then 'shoes'
    when 'hat' then 'hat' when 'belt' then 'belt' when 'bag' then 'bag'
    when 'scarf' then 'scarf' when 'accessory' then 'accessory'
    else null
  end;
$$;

create or replace function public.lock_custom_wardrobe_category(p_category text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_category is null or p_category in (
    'top', 'bottom', 'dress', 'jacket', 'coat', 'shoes',
    'hat', 'belt', 'bag', 'scarf', 'accessory'
  ) then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_category, 0));
end;
$$;

revoke all on function public.lock_custom_wardrobe_category(text) from PUBLIC, anon, authenticated;

create or replace function public.wardrobe_slot_for_owner_category(
  p_owner_id uuid,
  p_category text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_category
    when 'top' then 'top'
    when 'bottom' then 'bottom'
    when 'dress' then 'dress'
    when 'jacket' then 'outerwear'
    when 'coat' then 'outerwear'
    when 'shoes' then 'shoes'
    when 'hat' then 'hat'
    when 'belt' then 'belt'
    when 'bag' then 'bag'
    when 'scarf' then 'scarf'
    when 'accessory' then 'accessory'
    else (
      select category.slot
      from public.wardrobe_categories as category
      where category.owner_id = p_owner_id
        and category.id::text = p_category
    )
  end;
$$;

revoke all on function public.wardrobe_slot_for_owner_category(uuid, text) from PUBLIC, anon, authenticated;

alter table public.wardrobe_items add constraint wardrobe_items_slot_check
  check (slot in ('top','bottom','dress','outerwear','shoes','hat','belt','bag','scarf','accessory'));
alter table public.wardrobe_categories add constraint wardrobe_categories_slot_check
  check (slot in ('top','bottom','dress','outerwear','shoes','hat','belt','bag','scarf','accessory'));
alter table public.outfit_items add constraint outfit_items_slot_check
  check (slot in ('top','bottom','dress','outerwear','shoes','hat','belt','bag','scarf','accessory'));
