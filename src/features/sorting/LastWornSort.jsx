import { LAST_WORN_SORT, lastWornText } from "../../domain/lastWorn.js";
import "./sorting.css";

// Controlled last-worn sort control shared by Wardrobe, Outfits, and the planner picker. It owns
// no state and never fetches; the parent keeps the order and applies sortByLastWorn itself.
export function LastWornSort({ value, onChange, context = "" }) {
  const label = context ? `Sortera ${context}` : "Sortera";
  return (
    <label className="last-worn-sort">
      <span>Sortera</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value={LAST_WORN_SORT.STANDARD}>Standard</option>
        <option value={LAST_WORN_SORT.OLDEST}>Längst sedan använd</option>
        <option value={LAST_WORN_SORT.NEWEST}>Senast använd</option>
      </select>
    </label>
  );
}

// Subdued metadata line shown only while a chronological sort is active.
export function LastWornMeta({ value }) {
  return <p className="last-worn-meta">{lastWornText(value)}</p>;
}
