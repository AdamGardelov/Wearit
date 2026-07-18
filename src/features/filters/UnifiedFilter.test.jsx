import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnifiedFilter } from "./UnifiedFilter.jsx";
import { ITEM_FILTER_GROUPS, OUTFIT_FILTER_GROUPS } from "../../domain/filters.js";

afterEach(cleanup);

const colors = [
  { id: "green", label: "Grön", swatch: "#4a8c3f" },
  { id: "black", label: "Svart", swatch: "#1c1c1c" },
  { id: "blue", label: "Blå", swatch: "#2f5fb0" },
];
const summer = { id: "s-summer", kind: "season", seasonKey: "summer", name: "Summer", locked: true };
const rainy = { id: "t-rainy", kind: "theme", seasonKey: null, name: "Rainy day", locked: false };
const labels = [summer, rainy];
const empty = { selectedColorIds: [], selectedSeasonIds: [], selectedThemeIds: [] };

function renderFilter(props = {}) {
  return render(
    <UnifiedFilter
      groups={ITEM_FILTER_GROUPS}
      colors={colors}
      labels={labels}
      value={empty}
      onChange={vi.fn()}
      visibleCount={2}
      totalCount={5}
      {...props}
    />,
  );
}

describe("UnifiedFilter", () => {
  it("shows colour swatches with Swedish names and preserves other selections when toggling", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderFilter({
      value: { selectedColorIds: ["black"], selectedSeasonIds: ["s-summer"], selectedThemeIds: [] },
      onChange,
    });

    await user.click(screen.getByRole("button", { name: "Filter" }));
    const gron = screen.getByRole("checkbox", { name: "Grön" });
    expect(gron.closest("label").querySelector(".unified-filter-swatch")).toBeInTheDocument();

    await user.click(gron);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      selectedColorIds: ["black", "green"],
      selectedSeasonIds: ["s-summer"],
    }));
  });

  it("keeps two colours selected at once", async () => {
    const user = userEvent.setup();
    renderFilter({ value: { ...empty, selectedColorIds: ["green", "black"] } });
    await user.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.getByRole("checkbox", { name: "Grön" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Svart" })).toBeChecked();
  });

  it("renders a removable colour chip with a swatch", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderFilter({ value: { ...empty, selectedColorIds: ["green"] }, onChange });

    const remove = screen.getByRole("button", { name: "Ta bort Grön" });
    expect(remove.closest(".unified-filter-chip").querySelector(".unified-filter-swatch")).toBeInTheDocument();
    await user.click(remove);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selectedColorIds: [] }));
  });

  it("counts individual applicable selections in the badge", () => {
    renderFilter({
      value: { selectedColorIds: ["green", "black"], selectedSeasonIds: ["s-summer"], selectedThemeIds: [] },
    });
    expect(screen.getByRole("button", { name: "Filter" })).toHaveTextContent("3");
  });

  it("shows the summary only when an applicable group is active", () => {
    const view = renderFilter({ value: { ...empty, selectedColorIds: ["green"] } });
    expect(screen.getByText("2 av 5")).toBeInTheDocument();
    view.unmount();

    renderFilter({
      groups: OUTFIT_FILTER_GROUPS,
      resultNoun: "outfits",
      value: { ...empty, selectedColorIds: ["green"] },
    });
    expect(screen.queryByText("2 av 5")).not.toBeInTheDocument();
  });

  it("hides colour entirely for outfit groups but keeps it in state on Clear all", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderFilter({
      groups: OUTFIT_FILTER_GROUPS,
      resultNoun: "outfits",
      value: { selectedColorIds: ["green"], selectedSeasonIds: ["s-summer"], selectedThemeIds: [] },
      onChange,
    });

    expect(screen.queryByRole("button", { name: "Ta bort Grön" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter" })).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.queryByText("Färg")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rensa alla" }));
    expect(onChange).toHaveBeenCalledWith({
      selectedColorIds: ["green"],
      selectedSeasonIds: [],
      selectedThemeIds: [],
    });
  });

  it("keeps colour usable when label loading fails", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderFilter({ error: "Etikettfel.", onChange });

    await user.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Etikettfel.");
    expect(screen.queryByRole("checkbox", { name: "Sommar" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Grön" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selectedColorIds: ["green"] }));
  });

  it("closes and restores trigger focus via Escape and the mobile action", async () => {
    const user = userEvent.setup();
    renderFilter({ visibleCount: 4, totalCount: 10 });
    const trigger = screen.getByRole("button", { name: "Filter" });

    await user.click(trigger);
    expect(screen.getByRole("group", { name: "Filter" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Filter" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Visa 4 plagg" }));
    expect(screen.queryByRole("group", { name: "Filter" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
