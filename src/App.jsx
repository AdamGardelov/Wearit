import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { availableColorFamilies } from "./domain/colors.js";
import { emptyAdvancedFilter, sanitizeAdvancedFilter } from "./domain/filters.js";
import { createWardrobeRepository } from "./data/wardrobeRepository.js";
import { ImportAdminView } from "./features/admin/ImportAdminView.jsx";
import { DressingRoom } from "./features/dress/DressingRoom.jsx";
import { HistoryView } from "./features/history/HistoryView.jsx";
import { WearDialog } from "./features/history/WearDialog.jsx";
import { OutfitsView } from "./features/outfits/OutfitsView.jsx";
import { SaveOutfitDialog } from "./features/outfits/SaveOutfitDialog.jsx";
import { WardrobeView } from "./features/wardrobe/WardrobeView.jsx";
import { supabase } from "./lib/supabase.js";

const SECTIONS = [
  { id: "wardrobe", label: "Wardrobe" },
  { id: "dress", label: "Dress" },
  { id: "outfits", label: "Outfits" },
  { id: "history", label: "History" },
];

// Stable empty fallback so `items` keeps a constant identity while the snapshot belongs to a
// previous repository. `colors` is memoized on `items`, so a fresh [] each render would make
// the colour-sanitize effect re-run every render and loop during a repository swap.
const EMPTY_ITEMS = [];

export function App({ repository: injectedRepository }) {
  const [section, setSection] = useState("wardrobe");
  const [actionStatus, setActionStatus] = useState("");
  const [saveSelection, setSaveSelection] = useState(null);
  const [loadedOutfit, setLoadedOutfit] = useState(null);
  const [loadRequest, setLoadRequest] = useState(null);
  const [outfitsRefreshKey, setOutfitsRefreshKey] = useState(0);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [wearRequest, setWearRequest] = useState(null);
  const baseRepository = useMemo(
    () => injectedRepository ?? createWardrobeRepository(supabase),
    [injectedRepository],
  );
  const currentRepositoryRef = useRef(baseRepository);
  currentRepositoryRef.current = baseRepository;
  const [itemSnapshot, setItemSnapshot] = useState(() => ({
    repository: baseRepository,
    items: [],
  }));
  const itemSnapshotRef = useRef(itemSnapshot);
  const [labelsState, setLabelsState] = useState(() => ({
    repository: baseRepository,
    labels: [],
    loading: true,
    error: "",
  }));
  const [advancedFilter, setAdvancedFilter] = useState(emptyAdvancedFilter);

  // Load the owner's labels once per repository. A repository double without
  // listLabels degrades to an empty, successfully loaded list; the app shell stays
  // visible on failure so an error is never mistaken for an empty wardrobe.
  useEffect(() => {
    let active = true;
    setAdvancedFilter(emptyAdvancedFilter());
    if (typeof baseRepository.listLabels !== "function") {
      setLabelsState({ repository: baseRepository, labels: [], loading: false, error: "" });
      return () => { active = false; };
    }
    setLabelsState({ repository: baseRepository, labels: [], loading: true, error: "" });
    baseRepository.listLabels()
      .then((labels) => {
        if (active) setLabelsState({ repository: baseRepository, labels, loading: false, error: "" });
      })
      .catch((error) => {
        if (active) {
          setLabelsState({
            repository: baseRepository,
            labels: [],
            loading: false,
            error: error?.message || "Kunde inte ladda etiketter.",
          });
        }
      });
    return () => { active = false; };
  }, [baseRepository]);

  const labels = labelsState.repository === baseRepository ? labelsState.labels : [];
  const labelsLoading = labelsState.repository === baseRepository ? labelsState.loading : true;
  const labelsError = labelsState.repository === baseRepository ? labelsState.error : "";
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  const createTheme = useCallback(async (name) => {
    const theme = await baseRepository.createTheme(name);
    setLabelsState((current) => (current.repository === baseRepository
      ? { ...current, labels: [...current.labels, theme] }
      : current));
    return theme;
  }, [baseRepository]);

  const renameTheme = useCallback(async (labelId, name) => {
    const theme = await baseRepository.renameTheme(labelId, name);
    setLabelsState((current) => (current.repository === baseRepository
      ? { ...current, labels: current.labels.map((label) => (label.id === labelId ? theme : label)) }
      : current));
    return theme;
  }, [baseRepository]);

  const deleteTheme = useCallback(async (labelId) => {
    await baseRepository.deleteTheme(labelId);
    const remaining = labelsRef.current.filter((label) => label.id !== labelId);
    setLabelsState((current) => (current.repository === baseRepository
      ? { ...current, labels: current.labels.filter((label) => label.id !== labelId) }
      : current));
    // Preserve Colour; only sanitize the season/theme selections against the labels.
    setAdvancedFilter((current) => sanitizeAdvancedFilter(current, { labels: remaining }));
  }, [baseRepository]);

  const repository = useMemo(() => {
    let activeItemsRequest = null;
    const isCurrent = () => currentRepositoryRef.current === baseRepository;
    const ownedItems = () => itemSnapshotRef.current.repository === baseRepository
      ? itemSnapshotRef.current.items
      : [];
    const synchronize = (nextItems) => {
      if (!isCurrent()) return;
      const nextSnapshot = { repository: baseRepository, items: nextItems };
      itemSnapshotRef.current = nextSnapshot;
      setItemSnapshot(nextSnapshot);
    };
    const refreshItems = async () => {
      const loadItems = typeof baseRepository.listItemsWithLastWorn === "function"
        ? baseRepository.listItemsWithLastWorn.bind(baseRepository)
        : baseRepository.listItems.bind(baseRepository);
      const loadedItems = await loadItems();
      synchronize(loadedItems);
      return loadedItems;
    };

    return {
      ...baseRepository,
      listItems(options) {
        if (options?.includeArchived) {
          return baseRepository.listItems(options);
        }
        if (!activeItemsRequest) {
          const request = Promise.resolve()
            .then(refreshItems)
            .finally(() => {
              if (activeItemsRequest === request) activeItemsRequest = null;
            });
          activeItemsRequest = request;
        }
        return activeItemsRequest;
      },
      async updateItem(item) {
        const savedItem = await baseRepository.updateItem(item);
        let synchronizedItem = {
          ...item,
          ...savedItem,
          cutoutUrl: savedItem.cutoutUrl ?? item.cutoutUrl,
        };
        const nextItems = ownedItems().map((existing) => {
          if (existing.id !== item.id) return existing;
          synchronizedItem = {
            ...existing,
            ...savedItem,
            cutoutUrl: savedItem.cutoutUrl ?? existing.cutoutUrl,
          };
          return synchronizedItem;
        });
        synchronize(nextItems);
        return synchronizedItem;
      },
      async archiveItem(itemId) {
        const archivedItem = await baseRepository.archiveItem(itemId);
        try {
          await refreshItems();
        } catch {
          synchronize(ownedItems().filter((item) => item.id !== itemId));
        }
        setOutfitsRefreshKey((current) => current + 1);
        return archivedItem;
      },
      refreshItems,
      async restoreItem(itemId) {
        const restoredItem = await baseRepository.restoreItem(itemId);
        let refreshedItem = null;
        try {
          const refreshedItems = await refreshItems();
          refreshedItem = refreshedItems.find((item) => item.id === itemId) ?? null;
        } catch {
          // The restore is committed; the next wardrobe load will retry the refresh.
        }
        setOutfitsRefreshKey((current) => current + 1);
        return refreshedItem ?? restoredItem;
      },
    };
  }, [baseRepository]);
  const items = itemSnapshot.repository === baseRepository ? itemSnapshot.items : EMPTY_ITEMS;

  // Colour families come from the complete owner snapshot, never a filtered view, so a
  // narrowing selection can never hide a colour that still exists in the wardrobe.
  const colors = useMemo(() => availableColorFamilies(items), [items]);

  useEffect(() => {
    setAdvancedFilter((current) => sanitizeAdvancedFilter(current, { colors }));
  }, [colors]);

  const loadOutfit = (savedItems, outfit) => {
    const liveItemsById = new Map(items.map((item) => [item.id, item]));
    const composition = savedItems
      .map((item) => {
        const live = liveItemsById.get(item.id);
        if (!live) return item;
        // Carry the saved stack position onto the live item so the reducer
        // reproduces the outfit's composed order instead of item defaults.
        return {
          ...live,
          saved_slot: item.saved_slot ?? live.slot,
          saved_layer_order: item.saved_layer_order,
        };
      })
      .filter((item) => item.status !== "archived");
    setLoadedOutfit(outfit);
    setLoadRequest((current) => ({
      key: (current?.key ?? 0) + 1,
      items: composition,
      previousSourceOutfit: loadedOutfit,
      sourceOutfit: outfit,
    }));
    setSection("dress");
    setActionStatus(`Laddade ${outfit.name}.`);
  };

  // Wardrobe's unified filter reads the shared advanced state directly. Theme mutation
  // callbacks stay separate; they belong to the item editor, not to the filter control.
  const advancedFilterProps = {
    colors,
    labels,
    advancedFilter,
    onAdvancedFilterChange: setAdvancedFilter,
    labelsLoading,
    labelsError,
  };

  // Transitional bridge: Dress and Outfits still render the old LabelFilter until Tasks 4
  // and 5 migrate them. Season/Theme selections share the same fields as advancedFilter, so
  // these props keep those views in sync while Colour is preserved untouched. Removed in Task 6.
  const labelProps = {
    labels,
    labelFilter: {
      selectedSeasonIds: advancedFilter.selectedSeasonIds,
      selectedThemeIds: advancedFilter.selectedThemeIds,
    },
    onLabelFilterChange: (next) => setAdvancedFilter((current) => ({
      ...current,
      selectedSeasonIds: next.selectedSeasonIds ?? [],
      selectedThemeIds: next.selectedThemeIds ?? [],
    })),
    labelsLoading,
    labelsError,
    onCreateTheme: createTheme,
    onRenameTheme: renameTheme,
    onDeleteTheme: deleteTheme,
  };

  const requestWear = (selection, sourceOutfit = null) => {
    const selectionIds = selection.map((item) => item.id).sort();
    const sourceIds = (sourceOutfit?.items || []).map((item) => item.id).sort();
    const keepsOutfitContext = sourceOutfit
      && selectionIds.length === sourceIds.length
      && selectionIds.every((itemId, index) => itemId === sourceIds[index]);
    setWearRequest({
      items: selection,
      outfitId: keepsOutfitContext ? sourceOutfit.id : null,
    });
  };

  return (
    <div className="wearit-app">
      <div
        data-testid="wearit-background"
        aria-hidden={wearRequest ? "true" : undefined}
        inert={wearRequest ? true : undefined}
      >
      <section className="app-section" hidden={section !== "wardrobe"}>
        <WardrobeView
          repository={repository}
          active={section === "wardrobe"}
          onMarkWorn={(selection) => requestWear(selection)}
          context="Garderob"
          {...advancedFilterProps}
          onCreateTheme={createTheme}
          onRenameTheme={renameTheme}
          onDeleteTheme={deleteTheme}
        />
      </section>
      <section className="app-section" hidden={section !== "dress"}>
        <DressingRoom
          items={items}
          loadRequest={loadRequest}
          onLoadedOutfitChange={setLoadedOutfit}
          onSave={(selection) => {
            setActionStatus("");
            setSaveSelection(selection);
          }}
          onWear={(selection) => requestWear(selection, loadedOutfit)}
          context="Styla"
          {...labelProps}
        />
        {actionStatus && <p className="app-action-status" role="status">{actionStatus}</p>}
      </section>
      <section className="app-section" hidden={section !== "outfits"}>
        {typeof repository.listOutfits === "function" ? (
          <OutfitsView
            repository={repository}
            active={section === "outfits"}
            refreshKey={outfitsRefreshKey}
            onLoad={loadOutfit}
            onWear={(selection, outfit) => requestWear(selection, outfit)}
            context="Outfits"
            {...labelProps}
          />
        ) : (
          <div className="placeholder-section">
            <p>Outfits</p>
            <h1>Sparade outfits är inte tillgängliga än.</h1>
          </div>
        )}
      </section>
      <section className="app-section" hidden={section !== "history"}>
        {typeof repository.listWearHistory === "function" ? (
          <HistoryView
            repository={repository}
            active={section === "history"}
            refreshKey={historyRefreshKey}
          />
        ) : (
          <div className="placeholder-section">
            <p>Historik</p>
            <h1>Historiken är inte tillgänglig än.</h1>
          </div>
        )}
      </section>
      {section === "admin" && (
        <section className="app-section">
          <ImportAdminView
            repository={repository}
            onClose={() => setSection("wardrobe")}
            onImported={async () => {
              try {
                await repository.refreshItems();
              } catch {
                // The import is committed; returning to Wardrobe will retry loading it.
              }
            }}
          />
        </section>
      )}

      {section !== "admin" && typeof repository.importWardrobeItem === "function" && (
        <button type="button" className="admin-launch" onClick={() => setSection("admin")}>
          Importera garderob
        </button>
      )}

      <nav className="bottom-nav" aria-label="Primär">
        {SECTIONS.map((entry) => {
          const active = section === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSection(entry.id)}
              aria-pressed={active}
              aria-current={active ? "page" : undefined}
            >
              {entry.label}
            </button>
          );
        })}
      </nav>

      {saveSelection && (
        <SaveOutfitDialog
          items={saveSelection}
          sourceOutfit={loadedOutfit}
          repository={repository}
          labels={labels}
          labelsLoading={labelsLoading}
          labelsError={labelsError}
          onClose={() => setSaveSelection(null)}
          onSaved={(savedOutfit) => {
            setLoadedOutfit(savedOutfit);
            setOutfitsRefreshKey((current) => current + 1);
            setActionStatus(`Sparade ${savedOutfit.name}.`);
          }}
        />
      )}
      </div>
      {wearRequest && (
        <WearDialog
          items={wearRequest.items}
          outfitId={wearRequest.outfitId}
          onClose={() => setWearRequest(null)}
          onRecord={async (payload) => {
            await repository.recordWear(payload);
            try {
              await repository.refreshItems();
            } catch {
              // The immutable event is saved; a later navigation will retry the refresh.
            }
            setHistoryRefreshKey((current) => current + 1);
            setActionStatus("Användning registrerad.");
          }}
        />
      )}
    </div>
  );
}
