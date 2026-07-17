import { useEffect, useMemo, useReducer } from "react";
import {
  EMPTY_MANNEQUIN,
  mannequinReducer,
  selectedItems,
} from "../../domain/mannequin.js";
import { GarmentTray } from "./GarmentTray.jsx";
import { MannequinCanvas } from "./MannequinCanvas.jsx";

export function DressingRoom({ items, onSave, onWear }) {
  const [state, dispatch] = useReducer(mannequinReducer, EMPTY_MANNEQUIN);
  const reconciledState = useMemo(
    () => mannequinReducer(state, { type: "reconcile", items }),
    [items, state],
  );

  useEffect(() => {
    if (reconciledState !== state) {
      dispatch({ type: "reconcile", items });
    }
  }, [items, reconciledState, state]);

  const selection = selectedItems(reconciledState);
  const selectedIds = new Set(selection.map((item) => item.id));

  return (
    <main className="dressing-room">
      <section className="dress-canvas-pane" aria-label="Dressing room">
        <div className="dress-heading">
          <p>Dress</p>
          <span>{selection.length} selected</span>
        </div>
        <MannequinCanvas items={selection} />
        <div className="composition-controls" aria-label="Composition controls">
          <button
            type="button"
            onClick={() => dispatch({ type: "undo" })}
            disabled={!reconciledState.history.length}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "clear" })}
            disabled={!selection.length}
          >
            Clear
          </button>
        </div>
        <div className="outfit-actions">
          <button
            type="button"
            onClick={() => onSave?.(selectedItems(reconciledState))}
            disabled={selection.length < 2}
          >
            Save outfit
          </button>
          <button
            type="button"
            onClick={() => onWear?.(selectedItems(reconciledState))}
            disabled={!selection.length}
          >
            Wear outfit
          </button>
        </div>
      </section>

      <GarmentTray
        items={items}
        selectedIds={selectedIds}
        onSelect={(item) => dispatch({ type: "select", item })}
      />

      <aside className="selected-summary" aria-label="Selected garments">
        <p className="summary-kicker">Current look</p>
        <h2>Selected pieces</h2>
        {selection.length ? (
          <ol>
            {selection.map((item) => <li key={item.id}>{item.name || "Unnamed garment"}</li>)}
          </ol>
        ) : (
          <p className="summary-empty">Choose pieces from the tray to build an outfit.</p>
        )}
      </aside>
    </main>
  );
}
