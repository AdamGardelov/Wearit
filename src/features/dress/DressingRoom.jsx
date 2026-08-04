import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowLineDown, ArrowLineUp, X } from "@phosphor-icons/react";
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
import { CATEGORIES } from "../../domain/slots.js";
import { UnifiedFilter } from "../filters/UnifiedFilter.jsx";
import { GarmentTray } from "./GarmentTray.jsx";
import { MannequinCanvas } from "./MannequinCanvas.jsx";

function garmentName(item) {
  return item.name || "Namnlöst plagg";
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function LayerList({ items, onMove, onRemove = null, thumbnails = false }) {
  return (
    <ol className={`layer-list${thumbnails ? " layer-list--visual" : ""}`}>
      {items.map((item, index) => {
        const name = garmentName(item);
        const isFront = index === 0;
        const isBack = index === items.length - 1;
        return (
          <li key={item.id} className="layer-row">
            {thumbnails && (
              <span className="layer-thumbnail" aria-hidden="true">
                {item.cutoutUrl ? <img src={item.cutoutUrl} alt="" loading="lazy" decoding="async" /> : "—"}
              </span>
            )}
            <span className="layer-name">{name}</span>
            <div className="layer-actions">
              <button
                type="button"
                className="layer-move"
                onClick={() => onMove(item, "forward")}
                disabled={isFront}
                aria-label={`Flytta ${name} framåt`}
                title="Flytta framåt"
              >
                <ArrowLineUp size={18} weight="bold" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="layer-move"
                onClick={() => onMove(item, "backward")}
                disabled={isBack}
                aria-label={`Flytta ${name} bakåt`}
                title="Flytta bakåt"
              >
                <ArrowLineDown size={18} weight="bold" aria-hidden="true" />
              </button>
              {onRemove && (
                <button
                  type="button"
                  className="layer-remove"
                  onClick={() => onRemove(item)}
                  aria-label={`Ta bort ${name} från looken`}
                  title="Ta bort från looken"
                >
                  <X size={18} weight="bold" aria-hidden="true" />
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function LayerSheet({ items, onMove, onRemove, onClose }) {
  const sheetRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, []);

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = sheetRef.current
      ? [...sheetRef.current.querySelectorAll(FOCUSABLE_SELECTOR)]
      : [];
    if (!focusable.length) {
      event.preventDefault();
      sheetRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || !sheetRef.current.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !sheetRef.current.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="layer-sheet-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={sheetRef}
        className="layer-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="layer-sheet-heading"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <span className="layer-sheet-handle" aria-hidden="true" />
        <header>
          <div>
            <p>Aktuell look</p>
            <h2 id="layer-sheet-heading">Lager · {items.length} plagg</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Stäng lager">
            <X size={22} weight="bold" aria-hidden="true" />
          </button>
        </header>
        <LayerList
          items={items}
          onMove={onMove}
          onRemove={onRemove}
          thumbnails
        />
      </section>
    </div>
  );
}

export function DressingRoom({
  items,
  active = true,
  loadRequest = null,
  onLoadedOutfitChange,
  onSave,
  onWear,
  colors = null,
  categories = CATEGORIES,
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
  const canvasPaneRef = useRef(null);
  const [layerSheetOpen, setLayerSheetOpen] = useState(false);
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

  const removeLayer = (item) => {
    dispatch({ type: "select", item });
    if (selection.length === 1) setLayerSheetOpen(false);
  };

  const showLook = () => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    canvasPaneRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <main className="dressing-room">
      <section className="dress-canvas-pane" aria-label="Provrum" ref={canvasPaneRef}>
        <div className="dress-heading">
          <p>Styla</p>
          <span className="dress-selection-count">{selection.length} valda</span>
          {selection.length > 0 && (
            <button
              type="button"
              className="dress-layer-trigger"
              onClick={() => setLayerSheetOpen(true)}
              aria-haspopup="dialog"
            >
              Lager · {selection.length} valda
            </button>
          )}
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
          <LayerList items={layerRows} onMove={moveLayer} />
        ) : (
          <p className="summary-empty">Välj plagg från lådan för att bygga en outfit.</p>
        )}
      </aside>

      <GarmentTray
        items={items}
        active={active}
        categories={categories}
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

      {selection.length > 0 && (
        <div className="dress-mobile-summary">
          <span aria-live="polite">{selection.length} {selection.length === 1 ? "valt plagg" : "valda plagg"}</span>
          <div className="dress-mobile-summary-actions">
            <button
              type="button"
              className="dress-mobile-layers"
              onClick={() => setLayerSheetOpen(true)}
              aria-haspopup="dialog"
            >
              Lager
            </button>
            <button type="button" onClick={showLook}>Visa look</button>
          </div>
        </div>
      )}

      {layerSheetOpen && selection.length > 0 && (
        <LayerSheet
          items={layerRows}
          onMove={moveLayer}
          onRemove={removeLayer}
          onClose={() => setLayerSheetOpen(false)}
        />
      )}
    </main>
  );
}
