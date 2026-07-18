export function combinationKey(items) {
  return [...new Set((items || []).map((item) => item?.id).filter(Boolean))]
    .sort()
    .join("|");
}

export function validateOutfit(items) {
  if (!Array.isArray(items) || items.length < 2) {
    return { valid: false, message: "Välj minst två plagg." };
  }

  const ids = items.map((item) => item?.id);
  if (ids.some((id) => typeof id !== "string" || !id.trim())) {
    return { valid: false, message: "Alla plagg i outfiten måste vara giltiga." };
  }
  if (new Set(ids).size !== ids.length) {
    return { valid: false, message: "Välj varje plagg endast en gång." };
  }

  const slots = items.map((item) => item?.slot);
  if (slots.some((slot) => typeof slot !== "string" || !slot)) {
    return { valid: false, message: "Alla plagg måste ha en plats." };
  }
  if (new Set(slots).size !== slots.length) {
    return { valid: false, message: "Välj bara ett plagg per plats." };
  }
  if (slots.includes("dress") && (slots.includes("top") || slots.includes("bottom"))) {
    return { valid: false, message: "En klänning kan inte kombineras med en över- eller underdel." };
  }

  return { valid: true, message: "" };
}
