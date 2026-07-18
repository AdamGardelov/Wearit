# Outfit Delete Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the saved-outfit delete trigger as a professional corner icon that is always discoverable on touch and appears on hover or focus on desktop.

**Architecture:** Keep the existing React markup and delete flow. Add a computed-style regression test, then fix the CSS cascade with a selector more specific than the generic outfit-card button rule; retain a 44-pixel target while styling the SVG as the smaller visible circle.

**Tech Stack:** React 19, Vitest, Testing Library, CSS

---

### Task 1: Correct the outfit-card delete affordance

**Files:**
- Modify: `src/features/outfits/OutfitsView.test.jsx`
- Modify: `src/features/outfits/outfits.css`

- [ ] **Step 1: Write the failing computed-style regression test**

Add this test beside the existing deletion tests:

```jsx
it("keeps the delete trigger as a transparent 44px corner target", async () => {
  const repository = {
    listOutfits: vi.fn().mockResolvedValue([office]),
    deleteOutfit: vi.fn(),
  };
  render(<OutfitsView active repository={repository} onLoad={vi.fn()} />);

  const trigger = await screen.findByRole("button", { name: "Ta bort Office day" });
  const style = getComputedStyle(trigger);

  expect(style.width).toBe("44px");
  expect(style.height).toBe("44px");
  expect(style.minHeight).toBe("44px");
  expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
});
```

- [ ] **Step 2: Run the test and verify the current cascade fails**

Run:

```bash
npm test -- src/features/outfits/OutfitsView.test.jsx
```

Expected: FAIL because `.outfit-card button` currently wins, producing `width: 100%` and the ink background.

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
npm test -- src/features/outfits/OutfitsView.test.jsx
```

Expected: all OutfitsView tests pass, including the new computed-style regression.

- [ ] **Step 5: Run the production build**

Run:

```bash
npm run build
```

Expected: Vite exits successfully with no compilation errors.

- [ ] **Step 6: Commit the fix**

```bash
git add src/features/outfits/OutfitsView.test.jsx src/features/outfits/outfits.css
git commit -m "fix: restore compact outfit delete control"
```
