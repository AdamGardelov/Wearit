import { useEffect, useMemo, useReducer, useRef } from "react";
import { ArrowLineDown, ArrowLineUp } from "@phosphor-icons/react";
import {
  EMPTY_MANNEQUIN,
  mannequinReducer,
  selectedItems,
} from "../../domain/mannequin.js";
import { GarmentTray } from "./GarmentTray.jsx";
import { MannequinCanvas } from "./MannequinCanvas.jsx";

function garmentName(item) {
  return item.name || "Unnamed garment";
}

export function DressingRoom({ items, loadRequest = null, onLoadedOutfitChange, onSave, onWear }) {
  const [state, dispatch] = useReducer(mannequinReducer, EMPTY_MANNEQUIN);
  const loadedRequestKeyRef = useRef(null);
  const loadBoundariesRef = useRef([]);
  const reconciledState = useMemo(
    () => mannequinReducer(state, { type: "reconcile", items }),
    [items, state],
  );

  useEffect(() => {
    if (reconciledState !== state) {
      dispatch({ type: "reconcile", items });
    }
  }, [items, reconciledState, state]);

  useEffect(() => {
    if (!loadRequest || loadedRequestKeyRef.current === loadRequest.key) return;
    loadedRequestKeyRef.current = loadRequest.key;
    const historyLength = reconciledState.history.length + 1;
    loadBoundariesRef.current = loadBoundariesRef.current.filter(
      (boundary) => boundary.historyLength < historyLength,
    );
    loadBoundariesRef.current.push({
      historyLength,
      previousSourceOutfit: loadRequest.previousSourceOutfit ?? null,
      sourceOutfit: loadRequest.sourceOutfit ?? null,
    });
    dispatch({ type: "load", items: loadRequest.items });
  }, [loadRequest, reconciledState.history.length]);

  const selection = selectedItems(reconciledState);
  const selectedIds = new Set(selection.map((item) => item.id));
  // Layers are presented frontmost-first; selection is ordered back-to-front.
  const layerRows = [...selection].reverse();

  const undo = () => {
    const boundary = loadBoundariesRef.current.at(-1);
    if (boundary && reconciledState.history.length === boundary.historyLength) {
      loadBoundariesRef.current.pop();
      onLoadedOutfitChange?.(boundary.previousSourceOutfit);
    }
    dispatch({ type: "undo" });
  };

  const moveLayer = (item, direction) => {
    dispatch({ type: "move-layer", itemId: item.id, direction });
  };

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
            onClick={undo}
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

      <aside className="selected-summary" aria-label="Layers">
        <p className="summary-kicker">Current look</p>
        <h2>Layers</h2>
        {layerRows.length ? (
          <ol className="layer-list">
            {layerRows.map((item, index) => {
              const name = garmentName(item);
              const isFront = index === 0;
              const isBack = index === layerRows.length - 1;
              return (
                <li key={item.id} className="layer-row">
                  <span className="layer-name">{name}</span>
                  <div className="layer-actions">
                    <button
                      type="button"
                      className="layer-move"
                      onClick={() => moveLayer(item, "forward")}
                      disabled={isFront}
                      aria-label={`Move ${name} forward`}
                      title="Move forward"
                    >
                      <ArrowLineUp size={18} weight="bold" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="layer-move"
                      onClick={() => moveLayer(item, "backward")}
                      disabled={isBack}
                      aria-label={`Move ${name} backward`}
                      title="Move backward"
                    >
                      <ArrowLineDown size={18} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="summary-empty">Choose pieces from the tray to build an outfit.</p>
        )}
      </aside>

      <GarmentTray
        items={items}
        selectedIds={selectedIds}
        onSelect={(item) => dispatch({ type: "select", item })}
      />
    </main>
  );
}
