// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("./dress.css", import.meta.url), "utf8");

describe("mannequin layer stacking", () => {
  it("contains garment z-index values inside the mannequin stage", () => {
    const rule = stylesheet.match(/\.mannequin-stage\s*\{([^}]*)\}/)?.[1] || "";

    expect(rule).toMatch(/(?:^|\n)\s*isolation:\s*isolate\s*;/);
  });
});
