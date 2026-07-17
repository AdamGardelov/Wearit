import { describe, expect, it, vi } from "vitest";
import { readPublicConfig } from "./config.js";

describe("readPublicConfig", () => {
  it("returns the Supabase public configuration", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "  https://wardrobe.supabase.co  ");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "  sb_publishable_test  ");

    expect(readPublicConfig(import.meta.env)).toEqual({
      supabaseUrl: "https://wardrobe.supabase.co",
      supabasePublishableKey: "sb_publishable_test",
    });
  });

  it("starts each test with the safe public defaults", () => {
    expect(readPublicConfig(import.meta.env)).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      supabasePublishableKey: "sb_publishable_test",
    });
  });

  it("rejects a missing public URL without printing other values", () => {
    const secretSentinel = "sentinel-value-that-must-not-be-printed";
    let thrownError;

    try {
      readPublicConfig({
        VITE_SUPABASE_PUBLISHABLE_KEY: secretSentinel,
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError.message).toBe("Missing VITE_SUPABASE_URL.");
    expect(thrownError.message).not.toContain(secretSentinel);
  });

  it("rejects a missing public publishable key", () => {
    expect(() =>
      readPublicConfig({
        VITE_SUPABASE_URL: "https://wardrobe.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "  ",
      }),
    ).toThrowError(new Error("Missing VITE_SUPABASE_PUBLISHABLE_KEY."));
  });
});
