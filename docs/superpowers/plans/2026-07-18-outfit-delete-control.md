# Outfit Delete Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the saved-outfit delete trigger as a professional corner icon that is always discoverable on touch and appears on hover or focus on desktop.

**Architecture:** Keep the existing React markup and delete flow. Add a source-level CSS regression test because Vitest/jsdom does not load component stylesheets, then fix the cascade with a selector more specific than the generic outfit-card button rule; retain a 44-pixel target while styling the SVG as the smaller visible circle.

**Tech Stack:** React 19, Vitest, CSS

---

### Task 1: Correct the outfit-card delete affordance

**Files:**
- Create: `src/features/outfits/outfits.css.test.js`
- Modify: `src/features/outfits/outfits.css`

- [ ] **Step 1: Write the failing CSS-source regression test**

Create a focused test that reads the real stylesheet and extracts the more-specific delete-trigger block:

```js
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("./outfits.css", import.meta.url), "utf8");

describe("outfit delete control styles", () => {
  it("overrides the generic card button with a transparent 44px corner target", () => {
    const rule = stylesheet.match(/\.outfit-card \.outfit-delete-trigger\s*\{([^}]*)\}/)?.[1] || "";

    expect(rule).toMatch(/width:\s*44px/);
    expect(rule).toMatch(/height:\s*44px/);
    expect(rule).toMatch(/min-height:\s*44px/);
    expect(rule).toMatch(/background:\s*transparent/);
    expect(rule).toMatch(/padding:\s*0/);
  });
});
```

- [ ] **Step 2: Run the test and verify the current cascade fails**

Run:

```bash
npm test -- src/features/outfits/outfits.css.test.js
```

Expected: FAIL because the current stylesheet has only the less-specific `.outfit-delete-trigger` rule and the extracted rule is empty.

- [ ] **Step 3: Fix the selector and split target size from visible size**

Replace the delete-trigger styles with a rule that outranks the generic button rule:

```css
.outfit-card .outfit-delete-trigger {
  position: absolute;
  top: 2px;
  right: 2px;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  min-height: 44px;
  border: 0;
  border-radius: 999px;
  padding: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.outfit-delete-trigger svg {
  box-sizing: content-box;
  border-radius: 999px;
  padding: 8px;
  background: rgba(244, 240, 232, .88);
  transition: background 140ms ease, color 140ms ease;
}

.outfit-card .outfit-delete-trigger:hover {
  background: transparent;
  color: var(--accent);
}

.outfit-delete-trigger:hover svg { background: var(--paper); }
```

Keep the existing focus-visible rule and hover-capability media query. Their opacity behavior already implements always-visible touch and hover/focus desktop.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- src/features/outfits/outfits.css.test.js src/features/outfits/OutfitsView.test.jsx
```

Expected: the CSS regression and all existing OutfitsView interaction tests pass.

- [ ] **Step 5: Run the production build**

Run:

```bash
npm run build
```

Expected: Vite exits successfully with no compilation errors.

- [ ] **Step 6: Commit the fix**

```bash
git add src/features/outfits/outfits.css.test.js src/features/outfits/outfits.css
git commit -m "fix: restore compact outfit delete control"
```
