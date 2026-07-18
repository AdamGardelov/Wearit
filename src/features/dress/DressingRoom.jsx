import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { ArrowLineDown, ArrowLineUp } from "@phosphor-icons/react";
import {
  EMPTY_MANNEQUIN,
  mannequinReducer,
  selectedItems,
} from "../../domain/mannequin.js";
import { availableColorFamilies } from "../../domain/colors.js";
import {
  ITEM_FILTER_GROUPS,
  emptyAdvancedFilter,
  matchesAdvancedFilter,
} from "../../domain/filters.js";
import { UnifiedFilter } from "../filters/UnifiedFilter.jsx";
import { GarmentTray } from "./GarmentTray.jsx";
import { MannequinCanvas } from "./MannequinCanvas.jsx";

function garmentName(item) {
  return item.name || "Namnlöst plagg";
}

export function DressingRoom({
  items,
  loadRequest = null,
  onLoadedOutfitChange,
  onSave,
  onWear,
  colors = null,
  labels = [],
  advancedFilter = emptyAdvancedFilter(),
  onAdvancedFilterChange = () => {},
  labelsLoading = false,
  labelsError = "",
  context = "",
}) {
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

  // Fall back to local colours only when App does not supply the shared families.
  const availableColors = useMemo(
    () => colors ?? availableColorFamilies(items),
    [colors, items],
  );

  // The advanced filter narrows only the tray display. Reconciliation, loaded-outfit
  // provenance, and the mannequin selection stay bound to the full `items` list, so
  // filtering can never remove a garment that is already on the mannequin.
  const itemFilter = useCallback(
    (item) => matchesAdvancedFilter(item, advancedFilter, ITEM_FILTER_GROUPS),
    [advancedFilter],
  );

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
      <section className="dress-canvas-pane" aria-label="Provrum">
        <div className="dress-heading">
          <p>Styla</p>
          <span>{selection.length} valda</span>
        </div>
        <MannequinCanvas items={selection} />
        <div className="composition-controls" aria-label="Kompositionskontroller">
          <button
            type="button"
            onClick={undo}
            disabled={!reconciledState.history.length}
          >
            Ångra
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "clear" })}
            disabled={!selection.length}
          >
            Rensa
          </button>
        </div>
        <div className="outfit-actions">
          <button
            type="button"
            onClick={() => onSave?.(selectedItems(reconciledState))}
            disabled={selection.length < 2}
          >
            Spara outfit
          </button>
          <button
            type="button"
            onClick={() => onWear?.(selectedItems(reconciledState))}
            disabled={!selection.length}
          >
            Bär outfit
          </button>
        </div>
      </section>

      <aside className="selected-summary" aria-label="Lager">
        <p className="summary-kicker">Aktuell look</p>
        <h2>Lager</h2>
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
                      aria-label={`Flytta ${name} framåt`}
                      title="Flytta framåt"
                    >
                      <ArrowLineUp size={18} weight="bold" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="layer-move"
                      onClick={() => moveLayer(item, "backward")}
                      disabled={isBack}
                      aria-label={`Flytta ${name} bakåt`}
                      title="Flytta bakåt"
                    >
                      <ArrowLineDown size={18} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="summary-empty">Välj plagg från lådan för att bygga en outfit.</p>
        )}
      </aside>

      <GarmentTray
        items={items}
        selectedIds={selectedIds}
        onSelect={(item) => dispatch({ type: "select", item })}
        itemFilter={itemFilter}
        renderFilter={({ visibleCount, totalCount }) => (
          <UnifiedFilter
            groups={ITEM_FILTER_GROUPS}
            colors={availableColors}
            labels={labels}
            value={advancedFilter}
            onChange={onAdvancedFilterChange}
            loading={labelsLoading}
            error={labelsError}
            visibleCount={visibleCount}
            totalCount={totalCount}
            resultNoun="plagg"
            context={context}
          />
        )}
      />
    </main>
  );
}
