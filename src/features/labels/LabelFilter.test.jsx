import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LabelFilter } from "./LabelFilter.jsx";
import { emptyLabelFilter } from "../../domain/labels.js";

afterEach(cleanup);

const labels = [
  { id: "s-spring", kind: "season", seasonKey: "spring", name: "Spring", locked: true },
  { id: "s-summer", kind: "season", seasonKey: "summer", name: "Summer", locked: true },
  { id: "t-rainy", kind: "theme", seasonKey: null, name: "Rainy day", locked: false },
  { id: "t-bday", kind: "theme", seasonKey: null, name: "Birthday", locked: false },
];

describe("LabelFilter", () => {
  it("opens the panel, localizes seasons, and preserves other selections (multi-select)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <LabelFilter
        labels={labels}
        value={{ selectedSeasonIds: ["s-spring"], selectedThemeIds: [] }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.getByRole("checkbox", { name: "Vår" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Sommar" })).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Sommar" }));
    expect(onChange).toHaveBeenCalledWith({
      selectedSeasonIds: ["s-spring", "s-summer"],
      selectedThemeIds: [],
    });
  });

  it("shows removable chips, a visible count, and clears all", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <LabelFilter
        labels={labels}
        value={{ selectedSeasonIds: ["s-summer"], selectedThemeIds: ["t-rainy"] }}
        onChange={onChange}
        visibleCount={2}
        totalCount={5}
      />,
    );

    expect(screen.getByText("2 av 5")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ta bort Sommar" }));
    expect(onChange).toHaveBeenCalledWith({ selectedSeasonIds: [], selectedThemeIds: ["t-rainy"] });

    await user.click(screen.getByRole("button", { name: "Rensa alla" }));
    expect(onChange).toHaveBeenCalledWith(emptyLabelFilter());
  });

  it("shows the visible/total count only when a filter is active", () => {
    const { rerender } = render(
      <LabelFilter labels={labels} value={emptyLabelFilter()} onChange={vi.fn()} visibleCount={3} totalCount={5} />,
    );
    expect(screen.queryByText("3 av 5")).not.toBeInTheDocument();

    rerender(
      <LabelFilter
        labels={labels}
        value={{ selectedSeasonIds: ["s-summer"], selectedThemeIds: [] }}
        onChange={vi.fn()}
        visibleCount={3}
        totalCount={5}
      />,
    );
    expect(screen.getByText("3 av 5")).toBeInTheDocument();
  });

  it("shows an inline load error without implying the wardrobe is empty", async () => {
    const user = userEvent.setup();
    render(<LabelFilter labels={[]} value={emptyLabelFilter()} onChange={vi.fn()} error="Kunde inte ladda etiketter." />);
    await user.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Kunde inte ladda etiketter.");
  });
});
