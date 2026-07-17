export const EMPTY_MANNEQUIN = {
  selectedBySlot: {},
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

export function mannequinReducer(state, action) {
  switch (action.type) {
    case "select": {
      if (!isItem(action.item)) {
        return state;
      }

      return {
        selectedBySlot: nextSelection(state.selectedBySlot, action.item),
        history: [...state.history, state.selectedBySlot],
      };
    }

    case "clear": {
      if (Object.keys(state.selectedBySlot).length === 0) {
        return state;
      }

      return {
        selectedBySlot: {},
        history: [...state.history, state.selectedBySlot],
      };
    }

    case "load": {
      if (!Array.isArray(action.items)) {
        return state;
      }

      const selectedBySlot = {};
      for (const item of action.items) {
        if (!isItem(item) || selectedBySlot[item.slot]) {
          return state;
        }
        selectedBySlot[item.slot] = item;
      }

      return {
        selectedBySlot,
        history: [...state.history, state.selectedBySlot],
      };
    }

    case "undo": {
      if (state.history.length === 0) {
        return state;
      }

      return {
        selectedBySlot: state.history.at(-1),
        history: state.history.slice(0, -1),
      };
    }

    default:
      return state;
  }
}

export function selectedItems(state) {
  return Object.values(state.selectedBySlot).sort(compareItems);
}
