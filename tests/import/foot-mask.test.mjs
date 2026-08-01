import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_STRAP_RUN_FRACTION,
  extractBodyMask,
  maskOpenFootwear,
  resolveMaxStrapRun,
  restrictToFeet,
} from "../../scripts/wearit-images/foot-mask.mjs";

const MAGENTA = [255, 0, 255];
const GREEN = [20, 201, 18];

/** Build an RGBA buffer with a painter callback returning [r,g,b,a] or null. */
function canvas(width, height, paint) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = paint(x, y) ?? [0, 0, 0, 0];
      const i = (y * width + x) * 4;
      data[i] = px[0]; data[i + 1] = px[1]; data[i + 2] = px[2]; data[i + 3] = px[3];
    }
  }
  return data;
}

const inBox = (x, y, l, t, r, b) => x >= l && x < r && y >= t && y < b;

/** A template: green everywhere, a magenta leg narrowing to a foot at the bottom. */
function template(width = 60, height = 200) {
  return canvas(width, height, (x, y) => {
    const leg = inBox(x, y, 24, 20, 36, 160);
    const foot = inBox(x, y, 20, 160, 40, 190);
    return leg || foot ? [...MAGENTA, 255] : [...GREEN, 255];
  });
}

describe("extractBodyMask", () => {
  it("marks body-key pixels and nothing else", () => {
    const w = 60, h = 200;
    const mask = extractBodyMask(template(w, h), w, h, { key: MAGENTA, tolerance: 32 });
    expect(mask[(100 * w + 30)]).toBe(1);   // inside the leg
    expect(mask[(100 * w + 5)]).toBe(0);    // background
    expect(mask[(175 * w + 22)]).toBe(1);   // inside the foot
  });

  it("tolerates the key colour drifting within tolerance", () => {
    const w = 4, h = 1;
    const data = canvas(w, h, (x) => (x < 2 ? [250, 6, 249, 255] : [...GREEN, 255]));
    const mask = extractBodyMask(data, w, h, { key: MAGENTA, tolerance: 32 });
    expect([...mask]).toEqual([1, 1, 0, 0]);
  });
});

describe("restrictToFeet", () => {
  it("keeps only the bottom slice of the body and reports its bounds", () => {
    const w = 60, h = 200;
    const body = extractBodyMask(template(w, h), w, h, { key: MAGENTA, tolerance: 32 });
    const { mask, footTop, footBottom } = restrictToFeet(body, w, h, { footTopFraction: 0.2 });

    expect(footBottom).toBe(189);
    // body spans y=20..189 (170 rows); the bottom 20% starts at 189 - 34 + 1
    expect(footTop).toBe(156);
    expect(mask[175 * w + 22]).toBe(1);     // foot retained
    expect(mask[100 * w + 30]).toBe(0);     // leg dropped
  });

  it("throws rather than guessing when the template has no body pixels", () => {
    const w = 4, h = 4;
    const empty = new Uint8Array(w * h);
    expect(() => restrictToFeet(empty, w, h, { footTopFraction: 0.2 }))
      .toThrow(/no body pixels/i);
  });
});

describe("resolveMaxStrapRun", () => {
  it("scales with the foot height so the separator survives a canvas change", () => {
    // 158 foot rows is the real 887x1774 mannequin; 0.25 gives the 40px that was
    // calibrated visually against two sandal layers.
    expect(resolveMaxStrapRun(158)).toBe(40);
    expect(resolveMaxStrapRun(316)).toBe(79);
    expect(DEFAULT_MAX_STRAP_RUN_FRACTION).toBe(0.25);
  });

  it("lets an explicit pixel count win over the fraction", () => {
    expect(resolveMaxStrapRun(158, { maxStrapRun: 12 })).toBe(12);
  });

  it("never returns a zero-length separator on a tiny foot", () => {
    expect(resolveMaxStrapRun(2)).toBeGreaterThanOrEqual(1);
  });

  it("rejects a fraction outside the open unit interval", () => {
    expect(() => resolveMaxStrapRun(158, { maxStrapRunFraction: 0 })).toThrow(/between 0 and 1/);
    expect(() => resolveMaxStrapRun(158, { maxStrapRunFraction: 1 })).toThrow(/between 0 and 1/);
  });
});

describe("maskOpenFootwear", () => {
  const w = 60, h = 200;
  const footMask = () => {
    const body = extractBodyMask(template(w, h), w, h, { key: MAGENTA, tolerance: 32 });
    return restrictToFeet(body, w, h, { footTopFraction: 0.2 }).mask;
  };

  /** A sandal: one thin strap across the foot, a big footbed fill over the toes,
   *  and a sole border that sits outside the foot outline. */
  const sandal = () => canvas(w, h, (x, y) => {
    const strap = inBox(x, y, 18, 163, 42, 171);         // 8px tall band
    const toeFill = inBox(x, y, 21, 172, 39, 188);       // 16px tall blob inside the foot
    const sole = inBox(x, y, 16, 160, 44, 192) && !inBox(x, y, 20, 160, 40, 190);
    return strap || toeFill || sole ? [10, 10, 10, 255] : null;
  });

  it("removes the footbed fill inside the footprint", () => {
    const { data, removedPixels } = maskOpenFootwear(sandal(), w, h, footMask(), { maxStrapRun: 10 });
    const alphaAt = (x, y) => data[(y * w + x) * 4 + 3];
    expect(alphaAt(30, 180)).toBe(0);      // middle of the toe fill, gone
    expect(removedPixels).toBeGreaterThan(0);
  });

  it("keeps a strap that crosses the same footprint", () => {
    const { data, keptStrapPixels } = maskOpenFootwear(sandal(), w, h, footMask(), { maxStrapRun: 10 });
    const alphaAt = (x, y) => data[(y * w + x) * 4 + 3];
    expect(alphaAt(30, 167)).toBe(255);    // middle of the strap, retained
    expect(keptStrapPixels).toBeGreaterThan(0);
  });

  it("never touches a pixel outside the footprint", () => {
    const before = sandal();
    const { data } = maskOpenFootwear(before, w, h, footMask(), { maxStrapRun: 10 });
    const alphaAt = (buf, x, y) => buf[(y * w + x) * 4 + 3];
    expect(alphaAt(before, 17, 175)).toBe(255);
    expect(alphaAt(data, 17, 175)).toBe(255);   // sole, outside the foot outline
    expect(alphaAt(data, 30, 191)).toBe(alphaAt(before, 30, 191)); // below the foot
  });

  it("is idempotent", () => {
    const once = maskOpenFootwear(sandal(), w, h, footMask(), { maxStrapRun: 10 });
    const twice = maskOpenFootwear(once.data, w, h, footMask(), { maxStrapRun: 10 });
    expect(twice.removedPixels).toBe(0);
    expect(Buffer.compare(once.data, twice.data)).toBe(0);
  });

  it("would erase a closed shoe, which is why callers must gate on open-toe topology", () => {
    // A sneaker fills the whole footprint. Documented here so the opt-in gate is
    // never mistaken for an optional detail.
    const sneaker = canvas(w, h, (x, y) =>
      (inBox(x, y, 16, 160, 44, 192) ? [10, 10, 10, 255] : null));
    const { removedPixels } = maskOpenFootwear(sneaker, w, h, footMask(), { maxStrapRun: 10 });
    expect(removedPixels).toBeGreaterThan(100);
  });
});
