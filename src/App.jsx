import { useMemo, useRef, useState } from "react";
import { createWardrobeRepository } from "./data/wardrobeRepository.js";
import { DressingRoom } from "./features/dress/DressingRoom.jsx";
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

    return {
      ...baseRepository,
      listItems(options) {
        if (options?.includeArchived) {
          return baseRepository.listItems(options);
        }
        if (!activeItemsRequest) {
          const request = Promise.resolve()
            .then(() => baseRepository.listItems(options))
            .then((loadedItems) => {
              synchronize(loadedItems);
              return loadedItems;
            })
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
        synchronize(ownedItems().filter((item) => item.id !== itemId));
        return archivedItem;
      },
      async restoreItem(itemId) {
        const restoredItem = await baseRepository.restoreItem(itemId);
        const existing = ownedItems().find((item) => item.id === itemId);
        const synchronizedItem = {
          ...existing,
          ...restoredItem,
          cutoutUrl: restoredItem.cutoutUrl ?? existing?.cutoutUrl,
        };
        synchronize([
          ...ownedItems().filter((item) => item.id !== itemId),
          synchronizedItem,
        ]);
        return synchronizedItem;
      },
    };
  }, [baseRepository]);
  const items = itemSnapshot.repository === baseRepository ? itemSnapshot.items : [];

  return (
    <div className="wearit-app">
      <section className="app-section" hidden={section !== "wardrobe"}>
        <WardrobeView repository={repository} active={section === "wardrobe"} />
      </section>
      <section className="app-section" hidden={section !== "dress"}>
        <DressingRoom
          items={items}
          onSave={() => setActionStatus("Outfit persistence is not available yet.")}
          onWear={() => setActionStatus("Wear tracking is not available yet.")}
        />
        {actionStatus && <p className="app-action-status" role="status">{actionStatus}</p>}
      </section>
      <section className="app-section placeholder-section" hidden={section !== "outfits"}>
        <p>Outfits</p>
        <h1>Saved outfits are not available yet.</h1>
      </section>
      <section className="app-section placeholder-section" hidden={section !== "history"}>
        <p>History</p>
        <h1>Wear history is not available yet.</h1>
      </section>

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
    </div>
  );
}
