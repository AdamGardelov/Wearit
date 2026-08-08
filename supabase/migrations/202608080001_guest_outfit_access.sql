-- A wardrobe guest may inspect the owner's saved outfits and load them into the
-- browser-only styling room. Writes, wear history, and weekly plans stay private.

create policy guests_select_outfits on public.outfits
for select to authenticated using (public.can_view_wardrobe(owner_id));

create policy guests_select_outfit_items on public.outfit_items
for select to authenticated using (public.can_view_wardrobe(owner_id));

create policy guests_select_outfit_labels on public.outfit_labels
for select to authenticated using (public.can_view_wardrobe(owner_id));
