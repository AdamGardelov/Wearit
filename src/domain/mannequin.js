export const EMPTY_MANNEQUIN = {
  selectedBySlot: {},
  layerBySlot: {},
  history: [],
};

const SLOT_ORDER = [
  "dress",
  "top",
  "bottom",
  "outerwear",
  "shoes",
  "accessory",
];
const SLOT_RANK = new Map(SLOT_ORDER.map((slot, index) => [slot, index]));

// Effective layers are normalized to unique, evenly spaced integers. Five is the
// most garments that can share the mannequin (a dress excludes top and bottom), so
// the largest value stays well within the 0-100 layer_order bound.
const LAYER_STEP = 10;

function nextSelection(selectedBySlot, item) {
  const selection = { ...selectedBySlot };

  if (item.slot === "dress") {
    delete selection.top;
    delete selection.bottom;
  } else if (item.slot === "top" || item.slot === "bottom") {
    delete selection.dress;
  }

  selection[item.slot] = item;
  return selection;
}

function isItem(item) {
  return (
    typeof item?.id === "string"
    && item.id.trim() !== ""
    && SLOT_RANK.has(item.slot)
  );
}

function compareIds(left, right) {
  if (left.id < right.id) {
    return -1;
  }
  if (left.id > right.id) {
    return 1;
  }
  return 0;
}

function compareItems(left, right) {
  const leftHasLayer = Number.isFinite(left.layer_order);
  const rightHasLayer = Number.isFinite(right.layer_order);

  if (leftHasLayer && rightHasLayer && left.layer_order !== right.layer_order) {
    return left.layer_order - right.layer_order;
  }
  if (leftHasLayer !== rightHasLayer) {
    return leftHasLayer ? -1 : 1;
  }

  const slotDifference = (
    (SLOT_RANK.get(left.slot) ?? SLOT_ORDER.length)
    - (SLOT_RANK.get(right.slot) ?? SLOT_ORDER.length)
  );
  return slotDifference || compareIds(left, right);
}

function effectiveLayer(layerBySlot, slot, item) {
  const explicit = layerBySlot?.[slot];
  return Number.isFinite(explicit) ? explicit : item.layer_order;
}

// Selected garments ordered back-to-front with the composition's effective layer
// applied. The reducer never mutates the wardrobe item's own default layer_order.
function orderedSelection(state) {
  const selectedBySlot = state.selectedBySlot ?? {};
  const layerBySlot = state.layerBySlot ?? {};
  return Object.entries(selectedBySlot)
    .map(([slot, item]) => ({ slot, item, layer: effectiveLayer(layerBySlot, slot, item) }))
    .sort((left, right) => compareItems(
      { ...left.item, layer_order: left.layer },
      { ...right.item, layer_order: right.layer },
    ));
}

function snapshotOf(state) {
  return {
    selectedBySlot: state.selectedBySlot,
    layerBySlot: state.layerBySlot ?? {},
  };
}

function sameSnapshot(left, right) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length
    && leftKeys.every((slot) => left[slot] === right[slot])
  );
}

function sameLayers(left = {}, right = {}) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length
    && leftKeys.every((slot) => left[slot] === right[slot])
  );
}

function samePair(left, right) {
  return (
    sameSnapshot(left.selectedBySlot, right.selectedBySlot)
    && sameLayers(left.layerBySlot, right.layerBySlot)
  );
}

function sanitizeSnapshot(snapshot, liveItemsById) {
  const candidatesBySlot = new Map();

  for (const [previousSlot, selectedItem] of Object.entries(snapshot)) {
    const liveItem = liveItemsById.get(selectedItem.id);
    if (!isItem(liveItem)) continue;

    const candidates = candidatesBySlot.get(liveItem.slot) ?? [];
    candidates.push({
      item: liveItem,
      canonical: previousSlot === liveItem.slot,
    });
    candidatesBySlot.set(liveItem.slot, candidates);
  }

  const sanitized = {};
  for (const slot of SLOT_ORDER) {
    const candidates = candidatesBySlot.get(slot);
    if (!candidates?.length) continue;
    candidates.sort((left, right) => {
      if (left.canonical !== right.canonical) return left.canonical ? -1 : 1;
      return compareIds(left.item, right.item);
    });
    sanitized[slot] = candidates[0].item;
  }

  if (sanitized.dress) {
    delete sanitized.top;
    delete sanitized.bottom;
  }

  return sanitized;
}

// Effective layers only survive for slots that remain occupied after reconciliation.
// An edited item that migrated slots simply falls back to its default layer_order.
function sanitizeLayers(layerBySlot = {}, sanitizedSelection) {
  const sanitized = {};
  for (const slot of Object.keys(sanitizedSelection)) {
    if (Number.isFinite(layerBySlot[slot])) sanitized[slot] = layerBySlot[slot];
  }
  return sanitized;
}

function reconcileState(state, items) {
  const liveItemsById = new Map(items.filter(isItem).map((item) => [item.id, item]));
  const selectedBySlot = sanitizeSnapshot(state.selectedBySlot, liveItemsById);
  const layerBySlot = sanitizeLayers(state.layerBySlot, selectedBySlot);
  const current = { selectedBySlot, layerBySlot };
  const history = [];

  for (const snapshot of state.history) {
    const sanitizedSelection = sanitizeSnapshot(snapshot.selectedBySlot, liveItemsById);
    const pair = {
      selectedBySlot: sanitizedSelection,
      layerBySlot: sanitizeLayers(snapshot.layerBySlot, sanitizedSelection),
    };
    if (!history.length || !samePair(history.at(-1), pair)) {
      history.push(pair);
    }
  }
  while (history.length && samePair(history.at(-1), current)) {
    history.pop();
  }

  const selectionUnchanged = sameSnapshot(state.selectedBySlot, selectedBySlot);
  const layersUnchanged = sameLayers(state.layerBySlot, layerBySlot);
  const historyUnchanged = (
    history.length === state.history.length
    && history.every((pair, index) => samePair(pair, state.history[index]))
  );
  return selectionUnchanged && layersUnchanged && historyUnchanged
    ? state
    : { selectedBySlot, layerBySlot, history };
}

// Preserve the effective layer for slots that remain selected. A slot that is newly
// occupied keeps the wardrobe item's default (no entry); a replaced slot inherits the
// outgoing garment's rank so same-slot swaps hold their stack position.
function nextLayers(state, item, selectedBySlot) {
  const previousLayers = state.layerBySlot ?? {};
  const previousItem = state.selectedBySlot?.[item.slot];
  const layers = {};

  for (const slot of Object.keys(selectedBySlot)) {
    if (slot === item.slot) continue;
    if (Number.isFinite(previousLayers[slot])) layers[slot] = previousLayers[slot];
  }

  if (previousItem) {
    const inherited = Number.isFinite(previousLayers[item.slot])
      ? previousLayers[item.slot]
      : previousItem.layer_order;
    if (Number.isFinite(inherited)) layers[item.slot] = inherited;
  }

  return layers;
}

export function mannequinReducer(state, action) {
  switch (action.type) {
    case "select": {
      if (!isItem(action.item)) {
        return state;
      }
      if (state.selectedBySlot[action.item.slot]?.id === action.item.id) {
        return state;
      }

      const selectedBySlot = nextSelection(state.selectedBySlot, action.item);
      return {
        selectedBySlot,
        layerBySlot: nextLayers(state, action.item, selectedBySlot),
        history: [...state.history, snapshotOf(state)],
      };
    }

    case "move-layer": {
      const ordered = orderedSelection(state);
      const index = ordered.findIndex((entry) => entry.item.id === action.itemId);
      if (index === -1) return state;

      const targetIndex = action.direction === "forward" ? index + 1 : index - 1;
      if (targetIndex < 0 || targetIndex >= ordered.length) return state;

      // Normalize to unique ranks, then swap the two adjacent slots.
      const layerBySlot = {};
      ordered.forEach((entry, position) => {
        layerBySlot[entry.slot] = (position + 1) * LAYER_STEP;
      });
      const movedSlot = ordered[index].slot;
      const neighborSlot = ordered[targetIndex].slot;
      const movedLayer = layerBySlot[movedSlot];
      layerBySlot[movedSlot] = layerBySlot[neighborSlot];
      layerBySlot[neighborSlot] = movedLayer;

      return {
        selectedBySlot: state.selectedBySlot,
        layerBySlot,
        history: [...state.history, snapshotOf(state)],
      };
    }

    case "clear": {
      if (Object.keys(state.selectedBySlot).length === 0) {
        return state;
      }

      return {
        selectedBySlot: {},
        layerBySlot: {},
        history: [...state.history, snapshotOf(state)],
      };
    }

    case "load": {
      if (!Array.isArray(action.items)) {
        return state;
      }

      const selectedBySlot = {};
      const layerBySlot = {};
      for (const item of action.items) {
        if (!isItem(item) || selectedBySlot[item.slot]) {
          return state;
        }
        selectedBySlot[item.slot] = item;
        const saved = Number.isFinite(item.saved_layer_order)
          ? item.saved_layer_order
          : item.layer_order;
        if (Number.isFinite(saved)) layerBySlot[item.slot] = saved;
      }

      return {
        selectedBySlot,
        layerBySlot,
        history: [...state.history, snapshotOf(state)],
      };
    }

    case "reconcile": {
      if (!Array.isArray(action.items)) {
        return state;
      }
      return reconcileState(state, action.items);
    }

    case "undo": {
      if (state.history.length === 0) {
        return state;
      }

      const previous = state.history.at(-1);
      return {
        selectedBySlot: previous.selectedBySlot,
        layerBySlot: previous.layerBySlot ?? {},
        history: state.history.slice(0, -1),
      };
    }

    default:
      return state;
  }
}

export function selectedItems(state) {
  const layerBySlot = state.layerBySlot ?? {};
  return orderedSelection(state).map(({ slot, item }) => {
    const explicit = layerBySlot[slot];
    return Number.isFinite(explicit) ? { ...item, layer_order: explicit } : item;
  });
}
