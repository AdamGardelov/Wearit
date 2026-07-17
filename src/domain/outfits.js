export function combinationKey(items) {
  return [...new Set((items || []).map((item) => item?.id).filter(Boolean))]
    .sort()
    .join("|");
}

export function validateOutfit(items) {
  if (!Array.isArray(items) || items.length < 2) {
    return { valid: false, message: "Choose at least two items." };
  }

  const ids = items.map((item) => item?.id);
  if (ids.some((id) => typeof id !== "string" || !id.trim())) {
    return { valid: false, message: "Every outfit item must be valid." };
  }
  if (new Set(ids).size !== ids.length) {
    return { valid: false, message: "Choose each item only once." };
  }

  const slots = items.map((item) => item?.slot);
  if (slots.some((slot) => typeof slot !== "string" || !slot)) {
    return { valid: false, message: "Every outfit item must have a slot." };
  }
  if (new Set(slots).size !== slots.length) {
    return { valid: false, message: "Choose only one item for each slot." };
  }
  if (slots.includes("dress") && (slots.includes("top") || slots.includes("bottom"))) {
    return { valid: false, message: "A dress cannot be combined with a top or bottom." };
  }

  return { valid: true, message: "" };
}
