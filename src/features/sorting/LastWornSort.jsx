import { useEffect, useRef, useState } from "react";
import { CaretDown, Check, SortAscending } from "@phosphor-icons/react";
import { LAST_WORN_SORT, lastWornText } from "../../domain/lastWorn.js";
import "./sorting.css";

const SORT_OPTIONS = [
  {
    value: LAST_WORN_SORT.STANDARD,
    label: "Standard",
    description: "Din vanliga ordning",
  },
  {
    value: LAST_WORN_SORT.OLDEST,
    label: "Längst sedan använd",
    description: "Hitta det du glömt bort",
  },
  {
    value: LAST_WORN_SORT.NEWEST,
    label: "Senast använd",
    description: "Det nyaste först",
  },
];

// Controlled last-worn sort shared by Wardrobe, Outfits, and the planner picker. The menu is
// local presentation state; the parent still owns the selected order and applies the sort.
export function LastWornSort({ value, onChange, context = "" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const label = context ? `Sortera ${context}` : "Sortera";
  const selectedOption = SORT_OPTIONS.find((option) => option.value === value) ?? SORT_OPTIONS[0];

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const closeToTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const openAndFocus = (index) => {
    setOpen(true);
    window.requestAnimationFrame(() => optionRefs.current[index]?.focus());
  };

  const handleTriggerKeyDown = (event) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      closeToTrigger();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const selectedIndex = SORT_OPTIONS.findIndex((option) => option.value === value);
      openAndFocus(selectedIndex >= 0 ? selectedIndex : 0);
    }
  };

  const handleMenuKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeToTrigger();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const currentIndex = optionRefs.current.indexOf(document.activeElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + direction + SORT_OPTIONS.length) % SORT_OPTIONS.length;
    optionRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="last-worn-sort" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={open ? "last-worn-sort-trigger open" : "last-worn-sort-trigger"}
        aria-label={`${label}, ${selectedOption.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <SortAscending size={17} weight="regular" aria-hidden="true" />
        <span className="last-worn-sort-trigger-copy">
          <span className="last-worn-sort-prefix">Sortera:</span>
          <span className="last-worn-sort-value">{selectedOption.label}</span>
        </span>
        <span className="last-worn-sort-mobile-label">Sortera</span>
        <CaretDown size={15} weight="bold" aria-hidden="true" />
      </button>

      {open && (
        <div className="last-worn-sort-menu" role="menu" aria-label={label} onKeyDown={handleMenuKeyDown}>
          <p>Sortera efter</p>
          {SORT_OPTIONS.map((option, index) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                ref={(node) => { optionRefs.current[index] = node; }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={selected ? "last-worn-sort-option selected" : "last-worn-sort-option"}
                onClick={() => {
                  onChange(option.value);
                  closeToTrigger();
                }}
              >
                <span className="last-worn-sort-check" aria-hidden="true">
                  {selected && <Check size={15} weight="bold" />}
                </span>
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Subdued metadata line shown only while a chronological sort is active.
export function LastWornMeta({ value }) {
  return <p className="last-worn-meta">{lastWornText(value)}</p>;
}
