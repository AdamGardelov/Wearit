// Named colour families used for wardrobe filtering. Item colours are stored as
// exact hex values, which are too granular to filter on directly, so each hex is
// mapped to one of these families (with a representative swatch for the chip).
export const COLOR_FAMILIES = [
  { id: "black", label: "Svart", swatch: "#1c1c1c" },
  { id: "grey", label: "Grå", swatch: "#8b8b8b" },
  { id: "white", label: "Vit", swatch: "#f1efe8" },
  { id: "beige", label: "Beige", swatch: "#d7c3a0" },
  { id: "brown", label: "Brun", swatch: "#6b4a2b" },
  { id: "red", label: "Röd", swatch: "#c0392b" },
  { id: "orange", label: "Orange", swatch: "#e07b39" },
  { id: "yellow", label: "Gul", swatch: "#e6c229" },
  { id: "green", label: "Grön", swatch: "#4a8c3f" },
  { id: "blue", label: "Blå", swatch: "#2f5fb0" },
  { id: "purple", label: "Lila", swatch: "#6b4a9c" },
  { id: "pink", label: "Rosa", swatch: "#d47ba8" },
];

export const COLOR_FAMILY_BY_ID = Object.fromEntries(
  COLOR_FAMILIES.map((family) => [family.id, family]),
);

const FAMILY_ORDER = new Map(COLOR_FAMILIES.map((family, index) => [family.id, index]));

function hexToRgb(value) {
  if (typeof value !== "string") return null;
  let hex = value.trim().replace(/^#/, "");
  if (hex.length === 3) hex = hex.split("").map((char) => char + char).join("");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHsl({ r, g, b }) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;

  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { h: hue, s: saturation, l: lightness };
}

// Map a single hex colour to a family id, or null if it can't be parsed.
export function colorFamily(value) {
  const rgb = hexToRgb(value);
  if (!rgb) return null;
  const { r, g, b } = rgb;

  // HSL saturation is misleading at the extremes, so classify near-white and
  // near-black straight from the channels first.
  if (r >= 205 && g >= 205 && b >= 205) return "white";
  if (r <= 38 && g <= 38 && b <= 38) return "black";

  const { h, s, l } = rgbToHsl(rgb);

  // Remaining greyscale: decide by lightness.
  if (s < 0.12) {
    if (l < 0.28) return "black";
    if (l > 0.78) return "white";
    return "grey";
  }
  // Warm, muted hues read as beige/brown rather than orange/yellow.
  if (h >= 20 && h <= 55 && s < 0.55) {
    return l < 0.45 ? "brown" : "beige";
  }
  if (l < 0.14) return "black";

  if (h < 15 || h >= 345) return l > 0.62 && s < 0.55 ? "pink" : "red";
  if (h < 45) return "orange";
  if (h < 68) return "yellow";
  if (h < 165) return "green";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  return "pink";
}

// The set of family ids an item's colours belong to.
export function itemColorFamilies(item) {
  const families = new Set();
  for (const hex of item?.colors ?? []) {
    const family = colorFamily(hex);
    if (family) families.add(family);
  }
  return families;
}

// The families present across a set of items, in the canonical display order.
export function availableColorFamilies(items) {
  const present = new Set();
  for (const item of items ?? []) {
    for (const family of itemColorFamilies(item)) present.add(family);
  }
  return COLOR_FAMILIES.filter((family) => present.has(family.id));
}
