# Wearit Gallery and Mobile Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reveal optional garment back images through a restrained desktop gallery crossfade and permanently hide the wardrobe import launcher below the desktop breakpoint.

**Architecture:** Derive the back asset from each item's existing structured `images` collection and stack it inside the current Wardrobe card media bounds. CSS activates the back layer only for desktop hover/focus-capable interaction, while React removes a failed back asset without disturbing the front. The import change is a CSS visibility rule at Wearit's existing `900px` breakpoint.

**Tech Stack:** React 19, Vite, Vitest/Testing Library, plain CSS, existing `OptimizedImage` and structured wardrobe image data.

---

## Working constraints

- Run this plan after `docs/superpowers/plans/2026-07-18-wearit-week-planner-and-last-worn.md`; it expects the `.gallery-entry` wrapper introduced by last-worn metadata.
- Work directly in `/home/adam/Dev/Lab/Wearit`; no worktree is required for this private v1.
- Read `docs/superpowers/specs/2026-07-18-wearit-week-planner-sorting-and-gallery-design.md` first.
- Do not change image storage, bundle formats, item detail/lightbox behavior, or mannequin layers.
- Feature-first development is intentional; strict TDD is not required.
- Stage only named files. Never stage user-owned `tmp/` or use `git add -A`.

## Task 0: Reconfirm the planner/sorting baseline

**Files:** None.

- [ ] Verify the prior plan is complete and the worktree has no unexpected overlap:

  ```bash
  cd /home/adam/Dev/Lab/Wearit
  git status --short --branch
  rg -n "gallery-entry|LastWornMeta|grid-template-columns: repeat\(5" src
  npm test
  npm run build
  ```

  Expected: sorting metadata and five-button navigation exist; tests and build exit 0.

## Task 1: Add front-to-back gallery crossfade

**Files:**

- Modify: `src/features/wardrobe/WardrobeView.jsx:17-36`
- Modify: `src/features/wardrobe/WardrobeView.test.jsx:1-142`
- Modify: `src/styles.css:147-187,940-957`
- Create: `src/styles.gallery.test.js`

- [ ] Derive the back image by semantic view, not array position. Track only load failure locally:

  ```jsx
  function GalleryItem({ item, selected, onOpen, buttonRef }) {
    const [backFailed, setBackFailed] = useState(false);
    const frontUrl = item.primaryImageUrl ?? item.cutoutUrl;
    const backUrl = item.images?.find((image) => image.view === "back")?.url ?? null;
    const showBack = Boolean(backUrl && !backFailed);
    const imageProps = {
      alt: "",
      sizes: "(max-width: 520px) calc(50vw - 16px), (max-width: 860px) calc(33vw - 18px), 180px",
      breakpoints: [120, 180, 240, 320, 480],
    };

    return (
      <button ref={buttonRef} className={`gallery-item${selected ? " selected" : ""}`}
        type="button" onClick={() => onOpen(item.id)}
        aria-label={`Visa ${itemLabel(item)}`} aria-pressed={selected}
        data-testid={`wardrobe-item-${item.id}`}>
        <span className={`gallery-item-media${showBack ? " has-back" : ""}`}>
          <OptimizedImage {...imageProps} className="gallery-image gallery-image-front"
            data-view="front" src={frontUrl} />
          {showBack && (
            <OptimizedImage {...imageProps} className="gallery-image gallery-image-back"
              data-view="back" src={backUrl} onError={() => setBackFailed(true)} />
          )}
        </span>
      </button>
    );
  }
  ```

- [ ] Replace the single-image sizing rules with fixed stacked media bounds. Preserve the existing scale and drop shadow:

  ```css
  .gallery-item-media {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
  }

  .gallery-item .gallery-image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    opacity: 1;
    transform: scale(.94);
    filter: drop-shadow(0 14px 18px rgba(40, 36, 30, .18));
    transition: opacity 160ms ease, transform 220ms cubic-bezier(.2, .7, .2, 1);
  }

  .gallery-item .gallery-image-back { opacity: 0; }

  @media (hover: hover) and (pointer: fine) {
    .gallery-item:hover .has-back .gallery-image-front,
    .gallery-item:focus-visible .has-back .gallery-image-front { opacity: 0; }
    .gallery-item:hover .has-back .gallery-image-back,
    .gallery-item:focus-visible .has-back .gallery-image-back { opacity: 1; }
    .gallery-item:hover .gallery-image,
    .gallery-item:focus-visible .gallery-image { transform: scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .gallery-item .gallery-image { transition: none; }
  }
  ```

  Do not add touch handlers, timers, card flips, or source swapping.

- [ ] Add Testing Library cases:

  ```jsx
  const twoSided = {
    ...shirt,
    primaryImageUrl: "https://assets.test/front.webp",
    images: [
      { id: "front", view: "front", isPrimary: true, url: "https://assets.test/front.webp" },
      { id: "back", view: "back", isPrimary: false, url: "https://assets.test/back.webp" },
    ],
  };

  render(<WardrobeView repository={createRepository({
    listItems: vi.fn().mockResolvedValue([twoSided]),
  })} />);
  const card = await screen.findByRole("button", { name: "Visa Blue shirt" });
  expect(card.querySelector('[data-view="front"]')).toHaveAttribute("src", twoSided.primaryImageUrl);
  expect(card.querySelector('[data-view="back"]')).toHaveAttribute("src", twoSided.images[1].url);
  fireEvent.error(card.querySelector('[data-view="back"]'));
  expect(card.querySelector('[data-view="back"]')).not.toBeInTheDocument();
  expect(card.querySelector('[data-view="front"]')).toBeInTheDocument();
  ```

  Add a separate front-only case asserting one image and no `.has-back` class.

- [ ] In `src/styles.gallery.test.js`, read `styles.css` as text and assert the back-opacity rules live inside a combined hover/fine-pointer media query and the reduced-motion block removes transition. This protects the front-only touch contract from accidental global hover rules.

- [ ] Run and commit:

  ```bash
  npx vitest run src/features/wardrobe/WardrobeView.test.jsx src/styles.gallery.test.js
  git add src/features/wardrobe/WardrobeView.jsx src/features/wardrobe/WardrobeView.test.jsx src/styles.css src/styles.gallery.test.js
  git commit -m "feat: preview garment backs on desktop hover"
  ```

## Task 2: Make the import launcher desktop-only

**Files:**

- Modify: `src/styles.css:1036-1067`
- Modify: `src/styles.gallery.test.js`
- Keep unchanged: `src/App.jsx`

- [ ] Hide the launcher by default and reveal it only at the existing desktop breakpoint:

  ```css
  .admin-launch {
    display: none;
    position: fixed;
    /* retain every existing visual declaration */
  }

  @media (min-width: 900px) {
    .admin-launch { display: block; }
  }
  ```

  Keep the React condition based on repository capability. CSS owns only viewport visibility; do not add `matchMedia`, resize listeners, or a second mobile route guard.

- [ ] Extend the stylesheet regression test to assert `.admin-launch` is `display: none` in its base rule and `display: block` only inside `@media (min-width: 900px)`.

- [ ] Run and commit:

  ```bash
  npx vitest run src/styles.gallery.test.js src/features/admin/ImportAdminView.test.jsx
  git add src/styles.css src/styles.gallery.test.js
  git commit -m "fix: hide wardrobe import on mobile"
  ```

## Task 3: Verify the polish on real interaction modes

**Files:** None unless verification exposes a defect.

- [ ] Run automated checks:

  ```bash
  npm test
  npm run build
  ```

  Expected: both exit 0.

- [ ] Run the app:

  ```bash
  npm run dev
  ```

  Verify at widths below and above `900px`:

  - two-sided garments crossfade to the real back image only on desktop hover;
  - keyboard focus reveals the back and keeps a visible focus outline;
  - front-only garments do not fade blank;
  - touch/mobile keeps the front image;
  - opening the item still reaches the existing image gallery/lightbox;
  - reduced-motion removes the fade;
  - `Importera garderob` is absent below `900px` and present at `900px` and above.

- [ ] Confirm `git status --short` contains only known user-owned paths and commit only targeted verification fixes if needed.
