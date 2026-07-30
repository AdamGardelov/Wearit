-- Owner-scoped category synonyms mapped to the existing mannequin slots.
create table public.wardrobe_categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (name = trim(name) and char_length(name) between 1 and 80),
  normalized_name text generated always as (lower(trim(name))) stored,
  slot text not null check (slot in ('top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);

create unique index wardrobe_categories_owner_name_key
on public.wardrobe_categories (owner_id, normalized_name);

alter table public.wardrobe_categories enable row level security;

create policy owners_select_categories on public.wardrobe_categories
for select to authenticated using ((select auth.uid()) = owner_id);
create policy owners_insert_categories on public.wardrobe_categories
for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy owners_update_categories on public.wardrobe_categories
for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
create policy owners_delete_categories on public.wardrobe_categories
for delete to authenticated using ((select auth.uid()) = owner_id);

revoke all privileges on table public.wardrobe_categories from anon, authenticated;
grant select, insert, update, delete on table public.wardrobe_categories to authenticated;

-- Built-ins retain their historical IDs. Custom category IDs are UUID text values
-- looked up only in the supplied owner's category namespace.
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

create or replace function public.prevent_referenced_category_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.wardrobe_items as item where item.owner_id = old.owner_id and item.category = old.id::text) then
      raise exception 'A category assigned to wardrobe items cannot be deleted.' using errcode = '22023';
    end if;
    return old;
  end if;

  if (new.id is distinct from old.id or new.owner_id is distinct from old.owner_id or new.slot is distinct from old.slot)
     and exists (select 1 from public.wardrobe_items as item where item.owner_id = old.owner_id and item.category = old.id::text) then
    raise exception 'A category assigned to wardrobe items cannot change identity or slot.' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_referenced_category_change() from PUBLIC, anon, authenticated;

drop trigger if exists wardrobe_categories_reference_guard on public.wardrobe_categories;
create trigger wardrobe_categories_reference_guard
before update or delete on public.wardrobe_categories
for each row execute function public.prevent_referenced_category_change();

-- The old constraints only knew about built-in category IDs. Replace those
-- checks with one owner-aware trigger while retaining the independent slot
-- whitelist constraint already present on wardrobe_items.
do $$
declare
  constraint_row record;
  constraint_definition text;
begin
  for constraint_row in
    select constraint_name
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'wardrobe_items'
      and constraint_type = 'CHECK'
  loop
    select pg_get_constraintdef(pg_constraint.oid)
      into constraint_definition
    from pg_constraint
    where pg_constraint.conname = constraint_row.constraint_name
      and pg_constraint.conrelid = 'public.wardrobe_items'::regclass;

    if position('category' in lower(constraint_definition)) > 0 then
      execute format(
        'alter table public.wardrobe_items drop constraint %I',
        constraint_row.constraint_name
      );
    end if;
  end loop;
end;
$$;

create or replace function public.validate_wardrobe_item_category_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_slot text;
begin
  expected_slot := public.wardrobe_slot_for_owner_category(new.owner_id, new.category);
  if expected_slot is null or new.slot is distinct from expected_slot then
    raise exception 'The category and slot do not match.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists wardrobe_items_category_slot_validation on public.wardrobe_items;
create trigger wardrobe_items_category_slot_validation
before insert or update of owner_id, category, slot on public.wardrobe_items
for each row execute function public.validate_wardrobe_item_category_slot();

-- Keep the legacy import RPC built-in-only, but make label-aware item updates
-- resolve custom categories in the authenticated owner's namespace.
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
  v_expected_slot text;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  v_expected_slot := public.wardrobe_slot_for_owner_category(v_owner_id, p_category);
  if v_expected_slot is null or p_slot is distinct from v_expected_slot then
    raise exception using errcode = '22023', message = 'The category and slot do not match.';
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

revoke all on function public.update_wardrobe_item_with_labels(
  uuid, text, text, text, text, text, text, text[], text[],
  double precision, double precision, double precision, double precision, integer, uuid[]
) from PUBLIC, anon, authenticated;
grant execute on function public.update_wardrobe_item_with_labels(
  uuid, text, text, text, text, text, text, text[], text[],
  double precision, double precision, double precision, double precision, integer, uuid[]
) to authenticated;
