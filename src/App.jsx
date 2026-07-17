import { useMemo, useRef, useState } from "react";
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
  const items = itemSnapshot.repository === baseRepository ? itemSnapshot.items : [];

  const loadOutfit = (savedItems, outfit) => {
    const liveItemsById = new Map(items.map((item) => [item.id, item]));
    const composition = savedItems
      .map((item) => liveItemsById.get(item.id) ?? item)
      .filter((item) => item.status !== "archived");
    setLoadedOutfit(outfit);
    setLoadRequest((current) => ({
      key: (current?.key ?? 0) + 1,
      items: composition,
      previousSourceOutfit: loadedOutfit,
      sourceOutfit: outfit,
    }));
    setSection("dress");
    setActionStatus(`Loaded ${outfit.name}.`);
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
          />
        ) : (
          <div className="placeholder-section">
            <p>Outfits</p>
            <h1>Saved outfits are not available yet.</h1>
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
            <p>History</p>
            <h1>Wear history is not available yet.</h1>
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
          Import wardrobe
        </button>
      )}

      <nav className="bottom-nav" aria-label="Primary">
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
          onClose={() => setSaveSelection(null)}
          onSaved={(savedOutfit) => {
            setLoadedOutfit(savedOutfit);
            setOutfitsRefreshKey((current) => current + 1);
            setActionStatus(`Saved ${savedOutfit.name}.`);
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
            setActionStatus("Wear recorded.");
          }}
        />
      )}
    </div>
  );
}
