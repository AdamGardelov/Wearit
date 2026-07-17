import { afterEach, describe, expect, it, vi } from "vitest";
import { readPublicConfig } from "./config.js";

describe("readPublicConfig", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns the Supabase public configuration", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://wardrobe.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");

    expect(readPublicConfig(import.meta.env)).toEqual({
      supabaseUrl: "https://wardrobe.supabase.co",
      supabasePublishableKey: "sb_publishable_test",
    });
  });

  it("rejects a missing public value without printing secrets", () => {
    expect(() => readPublicConfig({})).toThrow("VITE_SUPABASE_URL");
  });
});
