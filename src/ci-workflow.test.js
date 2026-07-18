// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

describe("CI public configuration", () => {
  it("provides non-production Supabase values before tests import the app", () => {
    expect(workflow).toMatch(/(?:^|\n)env:\n\s+VITE_SUPABASE_URL:\s+https:\/\/wearit-ci\.supabase\.co\s*\n/);
    expect(workflow).toMatch(/(?:^|\n)\s+VITE_SUPABASE_PUBLISHABLE_KEY:\s+sb_publishable_ci_test\s*\n/);
  });
});
