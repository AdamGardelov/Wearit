import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORY_DEFINITIONS } from "../../src/domain/slots.js";

const migrationFile = resolve(process.cwd(), "supabase/migrations/202607300001_expand_wardrobe_categories.sql");

const quotedValues = (text) => [...text.matchAll(/'([^']+)'/g)].map(([, value]) => value);

describe("category registry SQL parity", () => {
  it("keeps migration categories, slots, and function mappings in sync with JavaScript", async () => {
    const sql = await readFile(migrationFile, "utf8");
    const expectedCategories = CATEGORY_DEFINITIONS.map(({ id }) => id);
    const expectedSlots = [...new Set(CATEGORY_DEFINITIONS.map(({ slot }) => slot))];
    const expectedMappings = CATEGORY_DEFINITIONS.map(({ id, slot }) => [id, slot]);

    const categoryCheck = sql.match(/wardrobe_items_category_check[\s\S]*?check \(category in \(([^)]+)\)\)/i);
    const slotCheck = sql.match(/wardrobe_items_slot_check[\s\S]*?check \(slot in \(([^)]+)\)\)/i);
    const functionCase = sql.match(/select case category([\s\S]*?)else null\s+end/i);

    expect(categoryCheck, "category check constraint is present").not.toBeNull();
    expect(slotCheck, "slot check constraint is present").not.toBeNull();
    expect(functionCase, "wardrobe_slot_for_category case is present").not.toBeNull();

    expect(quotedValues(categoryCheck[1])).toEqual(expectedCategories);
    expect(quotedValues(slotCheck[1])).toEqual(expectedSlots);
    const mappings = [...functionCase[1].matchAll(/when\s+'([^']+)'\s+then\s+'([^']+)'/gi)]
      .map(([, category, slot]) => [category, slot]);
    expect(mappings).toEqual(expectedMappings);
  });
});
