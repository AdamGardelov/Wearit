# Wearit Custom Item Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Let each user create named item-category synonyms, assign each to an existing mannequin slot, and reuse the category in later item editors.

**Architecture:** Keep built-in categories in the domain module and add owner-scoped custom category rows in Supabase. The repository loads and creates normalized category objects; App owns the repository-scoped category snapshot; WardrobeView and ItemEditorDialog consume the combined list. Database validation resolves built-ins or an owner’s custom category and stores the derived slot on the item.

**Tech Stack:** React 19, Vitest + Testing Library, Supabase migrations/RLS/pgtap, existing JavaScript repository adapter.

---

## File map

- Create: supabase/migrations/202607300001_custom_wardrobe_categories.sql
- Create: supabase/tests/database/custom_wardrobe_categories.test.sql
- Modify: src/domain/slots.js and add/update src/domain/slots.test.js
- Modify: src/data/wardrobeRepository.js and src/data/wardrobeRepository.test.js
- Modify: src/App.jsx and the existing App test file
- Modify: src/features/wardrobe/WardrobeView.jsx and ItemEditorDialog.jsx plus their tests
- Modify: src/features/wardrobe/wardrobe.css only for the inline form

### Task 1: Database category storage and validation

- [ ] Write pgtap tests in supabase/tests/database/custom_wardrobe_categories.test.sql for table/columns, RLS/grants, owner-scoped case-insensitive uniqueness, valid slots, built-in resolution, custom resolution, cross-owner rejection, and update_wardrobe_item_with_labels slot validation. Use the existing authenticated JWT fixtures.
- [ ] Run npm run test:db -- supabase/tests/database/custom_wardrobe_categories.test.sql. It must fail because the table and resolver do not exist.
- [ ] Create supabase/migrations/202607300001_custom_wardrobe_categories.sql. Add wardrobe_categories with UUID id, owner_id FK, trimmed 1–80 character name, generated lower(trim(name)) normalized_name, slot check, timestamps, owner/id uniqueness, and a unique owner/normalized-name index. Enable RLS and owner-only select/insert/update/delete policies with authenticated grants.
- [ ] Add wardrobe_slot_for_owner_category(owner_id, category), returning the seven existing built-in mappings or looking up an owner’s custom UUID category, otherwise null. Remove the fixed wardrobe_items.category check and old category-only slot check; add a trigger rejecting unknown categories or mismatches with SQLSTATE 22023. Replace update_wardrobe_item_with_labels with owner-aware validation. Leave import_wardrobe_item’s built-in-only contract unchanged.
- [ ] Rerun the focused pgtap test, then npm run test:db; both must pass.
- [ ] Commit the database slice with git add supabase/migrations/202607300001_custom_wardrobe_categories.sql supabase/tests/database/custom_wardrobe_categories.test.sql and git commit -m "feat: persist owner wardrobe categories".

### Task 2: Domain and repository category APIs

- [ ] Add failing tests for explicit builtIn metadata, custom-row normalization, unsupported slots, listCategories ordering/merging, createCategory trimming, and updateItem sending a custom category’s persisted slot.
- [ ] Run npx vitest run src/domain/slots.test.js src/data/wardrobeRepository.test.js; it must fail before implementation.
- [ ] Update src/domain/slots.js: preserve built-in IDs/labels, mark them builtIn: true, expose SLOT_OPTIONS using current Swedish slot labels, and add normalizeCustomCategory(row) returning { id, label, slot, builtIn: false } with strict validation. Keep slotForCategory limited to built-ins.
- [ ] Update src/data/wardrobeRepository.js with listCategories() (custom rows ordered by created_at/name, normalized after built-ins) and createCategory({ name, slot }) (trim, authenticate, insert, select, normalize). Make updateItem require item.slot for custom IDs and pass it unchanged; built-ins may derive their slot.
- [ ] Run the focused Vitest command; it must pass with all existing repository tests.
- [ ] Commit the domain/repository slice with git add src/domain/slots.js src/domain/slots.test.js src/data/wardrobeRepository.js src/data/wardrobeRepository.test.js and git commit -m "feat: load and create wardrobe categories".

### Task 3: App category loading and synchronization

- [ ] Add failing App tests with an injected repository: listCategories loads built-ins plus Kavajer, createCategory appends its result, repository swaps ignore late responses, and repositories without category methods fall back to built-ins.
- [ ] Run npx vitest run against the App test file; it must fail before wiring.
- [ ] Add repository-scoped categoriesState and EMPTY_CATEGORIES in src/App.jsx. Load categories independently from labels/items, fallback to built-ins when listCategories is absent, and append a created category only when baseRepository identity still matches. Pass categories, loading/error state, and onCreateCategory to WardrobeView.
- [ ] Rerun the focused App tests; they must pass.
- [ ] Commit the App slice with git add src/App.jsx and the App test file, then git commit -m "feat: synchronize wardrobe categories in app state".

### Task 4: Inline category creation in the item editor

- [ ] Add failing Testing Library cases in src/features/wardrobe/ItemEditorDialog.test.jsx: selecting + Lägg till kategori opens the form, blank names are rejected, duplicate errors are accessible, cancel restores the previous selection, success calls { name: "Kavajer", slot: "outerwear" }, selects the returned ID, and preserves other draft edits.
- [ ] Run npx vitest run src/features/wardrobe/ItemEditorDialog.test.jsx; it must fail before implementation.
- [ ] Add categories/categoriesLoading/categoriesError/onCreateCategory props to ItemEditorDialog.jsx. Render supplied categories plus a new-category sentinel. Keep creation state local; show name and SLOT_OPTIONS fields; trim/validate; call onCreateCategory; on success set draft.category and draft.slot and hide the form; on failure keep the draft and show a Swedish role=alert. Disable creation controls while creating.
- [ ] Add compact inline-form/error/action-row styles in wardrobe.css, preserving existing mobile target sizes.
- [ ] Rerun the focused editor tests; they must pass.
- [ ] Commit the editor slice with git add src/features/wardrobe/ItemEditorDialog.jsx src/features/wardrobe/ItemEditorDialog.test.jsx src/features/wardrobe/wardrobe.css and git commit -m "feat: create categories from item editor".

### Task 5: Wardrobe navigation and save integration

- [ ] Add failing WardrobeView tests for a custom category item: picker availability, selecting/filtering the custom navigation chip, empty saved categories hidden from navigation but present in the picker, and updateItem receiving both custom category ID and persisted slot.
- [ ] Run npx vitest run src/features/wardrobe/WardrobeView.test.jsx; it must fail before integration.
- [ ] Update WardrobeView.jsx to accept category props with built-in fallback, derive category metadata/counts from the complete category list and active items, retain All/fallback/focus behavior, and pass category creation props to ItemEditorDialog. Preserve returned item.slot during save; never infer a custom slot from its name.
- [ ] Run npx vitest run src/features/wardrobe/WardrobeView.test.jsx src/features/wardrobe/ItemEditorDialog.test.jsx; both suites must pass.
- [ ] Commit the integration slice with git add src/features/wardrobe/WardrobeView.jsx src/features/wardrobe/WardrobeView.test.jsx and git commit -m "feat: use custom categories in wardrobe".

### Task 6: Full verification and handoff

- [ ] Run npm test. Expected: Vitest exits 0.
- [ ] Run npm run build. Expected: Vite exits 0.
- [ ] Run npm run test:db. Expected: pgtap exits 0.
- [ ] Run git diff --check HEAD~5..HEAD and git status --short. Confirm no whitespace errors, only feature commits are new, and existing image-processing modifications/tmp files remain untouched.
- [ ] If a concrete regression appears, add its focused test and minimal fix, rerun the affected command, and commit fix: harden custom wardrobe categories. Do not broaden the feature or reformat unrelated files.

## Self-review

- Spec coverage: database table/RLS, owner uniqueness, required slot, picker UX, immediate selection, App synchronization, empty navigation behavior, error handling, and tests are covered by Tasks 1–5.
- Placeholder scan: no TBD/TODO/implement-later steps; every task has exact files, commands, and expected outcomes.
- Type consistency: category objects use id/label/slot/builtIn throughout; custom item saves carry the persisted slot from repository through App, WardrobeView, and the RPC.
