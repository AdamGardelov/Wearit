import { useEffect, useMemo, useState } from "react";
import { createGuestWardrobeRepository } from "../../data/wardrobeRepository.js";
import { emptyAdvancedFilter } from "../../domain/filters.js";
import { CATEGORIES } from "../../domain/slots.js";
import { WardrobeView } from "./WardrobeView.jsx";

export function GuestWardrobeView({ client, wardrobe }) {
  const repository = useMemo(
    () => createGuestWardrobeRepository(client, wardrobe.ownerId),
    [client, wardrobe.ownerId],
  );
  const [categories, setCategories] = useState(CATEGORIES);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState("");
  const [labels, setLabels] = useState([]);
  const [labelsLoading, setLabelsLoading] = useState(true);
  const [labelsError, setLabelsError] = useState("");
  const [advancedFilter, setAdvancedFilter] = useState(emptyAdvancedFilter);

  useEffect(() => {
    let active = true;
    setAdvancedFilter(emptyAdvancedFilter());
    setCategoriesLoading(true);
    setCategoriesError("");
    setLabelsLoading(true);
    setLabelsError("");

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

  return (
    <div className="wearit-app guest-wardrobe">
      <WardrobeView
        repository={repository}
        ownerName={wardrobe.displayName}
        readOnly
        categories={categories}
        categoriesLoading={categoriesLoading}
        categoriesError={categoriesError}
        labels={labels}
        labelsLoading={labelsLoading}
        labelsError={labelsError}
        advancedFilter={advancedFilter}
        onAdvancedFilterChange={setAdvancedFilter}
        context={`${wardrobe.displayName}s garderob`}
      />
    </div>
  );
}
