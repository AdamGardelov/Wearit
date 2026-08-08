import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createGuestWardrobeRepository } from "../../data/wardrobeRepository.js";
import { availableColorFamilies } from "../../domain/colors.js";
import { emptyAdvancedFilter } from "../../domain/filters.js";
import { CATEGORIES } from "../../domain/slots.js";
import { ScrollToTopButton } from "../../ScrollToTopButton.jsx";
import { DressingRoom } from "../dress/DressingRoom.jsx";
import { OutfitsView } from "../outfits/OutfitsView.jsx";
import { WardrobeView } from "./WardrobeView.jsx";

const GUEST_SECTIONS = [
  { id: "wardrobe", label: "Garderob" },
  { id: "dress", label: "Styla" },
  { id: "outfits", label: "Outfits" },
];

export function GuestWardrobeView({ client, wardrobe }) {
  const baseRepository = useMemo(
    () => createGuestWardrobeRepository(client, wardrobe.ownerId),
    [client, wardrobe.ownerId],
  );
  // Wardrobe and Styla share one signed item load, so switching sections does not
  // request a second set of short-lived asset URLs.
  const repository = useMemo(() => {
    let itemsRequest = null;
    return {
      ...baseRepository,
      listItems(options) {
        if (options?.includeArchived) return baseRepository.listItems(options);
        if (!itemsRequest) itemsRequest = baseRepository.listItems();
        return itemsRequest;
      },
    };
  }, [baseRepository]);
  const [section, setSection] = useState("wardrobe");
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState("");
  const [categories, setCategories] = useState(CATEGORIES);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState("");
  const [labels, setLabels] = useState([]);
  const [labelsLoading, setLabelsLoading] = useState(true);
  const [labelsError, setLabelsError] = useState("");
  const [advancedFilter, setAdvancedFilter] = useState(emptyAdvancedFilter);
  const [loadRequest, setLoadRequest] = useState(null);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [section]);

  useEffect(() => {
    let active = true;
    setAdvancedFilter(emptyAdvancedFilter());
    setItemsLoading(true);
    setItemsError("");
    setCategoriesLoading(true);
    setCategoriesError("");
    setLabelsLoading(true);
    setLabelsError("");

    repository.listItems()
      .then((loaded) => { if (active) setItems(loaded); })
      .catch((error) => {
        if (active) {
          setItems([]);
          setItemsError(error.message || "Kunde inte ladda garderoben.");
        }
      })
      .finally(() => { if (active) setItemsLoading(false); });

    repository.listCategories()
      .then((loaded) => { if (active) setCategories(loaded); })
      .catch((error) => {
        if (active) {
          setCategories(CATEGORIES);
          setCategoriesError(error.message || "Kunde inte ladda kategorier.");
        }
      })
      .finally(() => { if (active) setCategoriesLoading(false); });

    repository.listLabels()
      .then((loaded) => { if (active) setLabels(loaded); })
      .catch((error) => {
        if (active) {
          setLabels([]);
          setLabelsError(error.message || "Kunde inte ladda etiketter.");
        }
      })
      .finally(() => { if (active) setLabelsLoading(false); });

    return () => { active = false; };
  }, [repository]);

  const colors = useMemo(() => availableColorFamilies(items), [items]);
  const sharedFilterProps = {
    colors,
    categories,
    categoriesLoading,
    categoriesError,
    labels,
    labelsLoading,
    labelsError,
    advancedFilter,
    onAdvancedFilterChange: setAdvancedFilter,
  };

  const loadOutfit = (savedItems, outfit) => {
    const liveItems = new Map(items.map((item) => [item.id, item]));
    const composition = savedItems
      .map((item) => {
        const live = liveItems.get(item.id);
        if (!live) return item;
        return {
          ...live,
          saved_slot: item.saved_slot ?? live.slot,
          saved_layer_order: item.saved_layer_order,
        };
      })
      .filter((item) => item.status !== "archived");
    setLoadRequest((current) => ({
      key: (current?.key ?? 0) + 1,
      items: composition,
      sourceOutfit: outfit,
    }));
    setSection("dress");
  };

  return (
    <div className="wearit-app guest-wardrobe">
      <section className="app-section" hidden={section !== "wardrobe"}>
        <WardrobeView
          repository={repository}
          ownerName={wardrobe.displayName}
          active={section === "wardrobe"}
          readOnly
          context={`${wardrobe.displayName}s garderob`}
          {...sharedFilterProps}
        />
      </section>

      <section className="app-section" hidden={section !== "dress"}>
        {itemsError ? (
          <div className="placeholder-section">
            <p>Gäststyling</p>
            <h1>{itemsError}</h1>
          </div>
        ) : (
          <DressingRoom
            items={items}
            active={section === "dress"}
            loadRequest={loadRequest}
            readOnly
            context={`${wardrobe.displayName}s garderob`}
            {...sharedFilterProps}
          />
        )}
        {itemsLoading && !itemsError && <p className="guest-section-loading">Laddar plagg…</p>}
      </section>

      <section className="app-section" hidden={section !== "outfits"}>
        <OutfitsView
          repository={repository}
          active={section === "outfits"}
          onLoad={loadOutfit}
          loadDisabled={itemsLoading || Boolean(itemsError)}
          ownerName={wardrobe.displayName}
          readOnly
          context={`${wardrobe.displayName}s outfits`}
          {...sharedFilterProps}
        />
      </section>

      {section !== "dress" && <ScrollToTopButton key={section} />}

      <nav className="bottom-nav guest-bottom-nav" aria-label="Delad garderob">
        {GUEST_SECTIONS.map((entry) => {
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
