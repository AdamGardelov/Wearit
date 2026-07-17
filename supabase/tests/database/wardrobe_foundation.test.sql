begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'wardrobe_items', 'wardrobe_items exists');
select has_column('public', 'wardrobe_items', 'owner_id', 'items have an owner');
select has_column('public', 'wardrobe_items', 'anchor_x', 'items have mannequin x');
select has_column('public', 'wardrobe_items', 'anchor_y', 'items have mannequin y');
select has_column('public', 'wardrobe_items', 'scale', 'items have mannequin scale');
select has_column('public', 'wardrobe_items', 'rotation_degrees', 'items have rotation');
select has_column('public', 'wardrobe_items', 'layer_order', 'items have layer order');
select col_is_fk('public', 'wardrobe_items', 'owner_id', 'item owner is a foreign key');
select policies_are('public', 'wardrobe_items', array['owners_select_items', 'owners_insert_items', 'owners_update_items'], 'items expose only owner policies');
select is((select public.wardrobe_slot_for_category('dress')), 'dress', 'dress maps to dress');
select is((select public.wardrobe_slot_for_category('jacket')), 'outerwear', 'jacket maps to outerwear');

select * from finish();
rollback;
