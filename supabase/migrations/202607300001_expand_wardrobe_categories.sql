alter table public.outfit_items drop constraint if exists outfit_items_slot_check;
alter table public.wardrobe_items drop constraint if exists wardrobe_items_check;
alter table public.wardrobe_items drop constraint if exists wardrobe_items_category_check;
alter table public.wardrobe_items drop constraint if exists wardrobe_items_slot_check;
alter table public.wardrobe_items drop constraint if exists wardrobe_items_category_slot_check;

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

alter table public.wardrobe_items add constraint wardrobe_items_category_check
  check (category in ('top','bottom','dress','jacket','coat','shoes','hat','belt','bag','scarf','accessory'));
alter table public.wardrobe_items add constraint wardrobe_items_slot_check
  check (slot in ('top','bottom','dress','outerwear','shoes','hat','belt','bag','scarf','accessory'));
alter table public.wardrobe_items add constraint wardrobe_items_category_slot_check
  check (slot = public.wardrobe_slot_for_category(category));
alter table public.outfit_items add constraint outfit_items_slot_check
  check (slot in ('top','bottom','dress','outerwear','shoes','hat','belt','bag','scarf','accessory'));
