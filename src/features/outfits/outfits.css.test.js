// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("./outfits.css", import.meta.url), "utf8");

describe("outfit delete control styles", () => {
  it("overrides the generic card button with a transparent 44px corner target", () => {
    const rule = stylesheet.match(/\.outfit-card \.outfit-delete-trigger\s*\{([^}]*)\}/)?.[1] || "";

    expect(rule).toMatch(/(?:^|\n)\s*width:\s*44px\s*;/);
    expect(rule).toMatch(/(?:^|\n)\s*height:\s*44px\s*;/);
    expect(rule).toMatch(/(?:^|\n)\s*min-height:\s*44px\s*;/);
    expect(rule).toMatch(/(?:^|\n)\s*background:\s*transparent\s*;/);
    expect(rule).toMatch(/(?:^|\n)\s*padding:\s*0\s*;/);
  });
});
