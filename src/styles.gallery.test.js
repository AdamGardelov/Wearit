import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest intercepts `.css` imports (returning an empty module), so read the source directly.
// Vitest runs from the project root, so the path is stable.
const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const normalized = css.replace(/\s+/g, " ");

// Return the brace-balanced body that follows the first occurrence of `marker`.
function blockAfter(marker) {
  const markerIndex = css.indexOf(marker);
  if (markerIndex === -1) return null;
  const open = css.indexOf("{", markerIndex);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

describe("gallery back-image stylesheet contract", () => {
  it("defaults the back image to hidden so touch layouts stay front-only", () => {
    expect(normalized).toContain(".gallery-image-back { opacity: 0;");
  });

  it("reveals the back only inside a hover + fine-pointer media query", () => {
    const hoverBlock = blockAfter("@media (hover: hover) and (pointer: fine)");
    expect(hoverBlock).toBeTruthy();
    expect(hoverBlock.replace(/\s+/g, " ")).toMatch(/\.gallery-image-back\s*\{\s*opacity:\s*1/);

    // No rule outside the desktop-only block ever reveals the back image.
    const withoutHover = css.replace(hoverBlock, "").replace(/\s+/g, " ");
    expect(withoutHover).not.toMatch(/\.gallery-image-back\s*\{\s*opacity:\s*1/);
  });

  it("removes the gallery image transition under reduced motion", () => {
    expect(normalized).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{ \.gallery-item \.gallery-image \{ transition: none;/,
    );
  });
});

describe("import launcher stylesheet contract", () => {
  it("hides the import launcher by default", () => {
    const base = blockAfter(".admin-launch {");
    expect(base).toBeTruthy();
    expect(base.replace(/\s+/g, " ")).toMatch(/display:\s*none/);
  });

  it("shows the import launcher only from the 900px breakpoint", () => {
    const desktopBlock = blockAfter("@media (min-width: 900px)");
    expect(desktopBlock).toBeTruthy();
    expect(desktopBlock.replace(/\s+/g, " ")).toMatch(/\.admin-launch\s*\{\s*display:\s*block/);

    // Nothing outside the desktop media query reveals the launcher.
    const withoutDesktop = css.replace(desktopBlock, "").replace(/\s+/g, " ");
    expect(withoutDesktop).not.toMatch(/\.admin-launch\s*\{\s*display:\s*block/);
  });
});
