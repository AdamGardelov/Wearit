import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyAdvancedFilter } from "../../domain/filters.js";
import { OutfitPickerDialog } from "./OutfitPickerDialog.jsx";

afterEach(cleanup);

const items = [{ id: "top-1", status: "active" }, { id: "bottom-1", status: "active" }];
const office = { id: "o-1", name: "Office", items, thumbnailUrl: "/o.webp", needs_attention: false, labelIds: [] };
const summer = { id: "o-2", name: "Summer", items, thumbnailUrl: "/s.webp", needs_attention: false, labelIds: ["s-summer"] };
const broken = { id: "o-3", name: "Broken", items: [{ id: "x", status: "archived" }], thumbnailUrl: "/b.webp", needs_attention: true, labelIds: [] };

const summerLabel = { id: "s-summer", kind: "season", seasonKey: "summer", name: "Summer", locked: true };

const order = () => screen.getAllByRole("button", { name: /^Välj / }).map((button) => button.getAttribute("aria-label"));

function PickerHarness({ repository, weekday = 3, initialFilter, ...props }) {
  const [filter, setFilter] = useState(initialFilter ?? emptyAdvancedFilter());
  return (
    <OutfitPickerDialog
      weekday={weekday}
      repository={repository}
      labels={[summerLabel]}
      advancedFilter={filter}
      onAdvancedFilterChange={setFilter}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  );
}

describe("OutfitPickerDialog", () => {
  it("loads saved outfits on open and titles the dialog with the weekday", async () => {
    const repository = { listOutfits: vi.fn().mockResolvedValue([office]) };
    render(<OutfitPickerDialog weekday={1} repository={repository} onSelect={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Välj Office för Måndag" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Välj outfit för Måndag" })).toBeInTheDocument();
    expect(repository.listOutfits).toHaveBeenCalledTimes(1);
  });

  it("selects only a valid outfit", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const repository = { listOutfits: vi.fn().mockResolvedValue([office]) };
    render(<OutfitPickerDialog weekday={2} repository={repository} onSelect={onSelect} onClose={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Välj Office för Tisdag" }));

    expect(onSelect).toHaveBeenCalledWith(office);
  });

  it("keeps a Needs-attention outfit visible but disabled and unselectable", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const repository = { listOutfits: vi.fn().mockResolvedValue([broken]) };
    render(<OutfitPickerDialog weekday={1} repository={repository} onSelect={onSelect} onClose={vi.fn()} />);

    const choose = await screen.findByRole("button", { name: "Välj Broken för Måndag" });
    expect(choose).toBeDisabled();
    expect(screen.getByText("Behöver åtgärdas")).toBeInTheDocument();

    await user.click(choose);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("filters the picker by shared Season/Theme without hiding assigned outfits elsewhere", async () => {
    const user = userEvent.setup();
    const repository = { listOutfits: vi.fn().mockResolvedValue([office, summer]) };
    render(<PickerHarness repository={repository} />);
    await screen.findByRole("button", { name: "Välj Office för Onsdag" });

    await user.click(screen.getByRole("button", { name: /^Filter/ }));
    await user.click(screen.getByRole("checkbox", { name: "Sommar" }));

    expect(screen.getByRole("button", { name: "Välj Summer för Onsdag" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Välj Office för Onsdag" })).not.toBeInTheDocument();
  });

  it("sorts by longest-since-used, placing never-used first, and shows metadata", async () => {
    const user = userEvent.setup();
    const never = { ...office, id: "o-never", name: "Never" };
    const old = { ...office, id: "o-old", name: "Old", last_worn_at: "2026-01-15T12:00:00Z" };
    const recent = { ...office, id: "o-recent", name: "Recent", last_worn_at: "2026-07-15T12:00:00Z" };
    const repository = { listOutfits: vi.fn().mockResolvedValue([recent, never, old]) };
    render(<OutfitPickerDialog weekday={1} repository={repository} onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "Välj Recent för Måndag" });

    expect(screen.queryByText("Aldrig använd")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Sortera Måndag" }), "oldest");

    expect(order()).toEqual([
      "Välj Never för Måndag",
      "Välj Old för Måndag",
      "Välj Recent för Måndag",
    ]);
    expect(screen.getByText("Aldrig använd")).toBeInTheDocument();
  });

  it("keeps Standard order and alerts when last-worn is unavailable", async () => {
    const user = userEvent.setup();
    const never = { ...office, id: "o-never", name: "Never", last_worn_unavailable: true };
    const old = { ...office, id: "o-old", name: "Old", last_worn_at: "2026-01-15T12:00:00Z", last_worn_unavailable: true };
    const recent = { ...office, id: "o-recent", name: "Recent", last_worn_at: "2026-07-15T12:00:00Z", last_worn_unavailable: true };
    const repository = { listOutfits: vi.fn().mockResolvedValue([recent, never, old]) };
    render(<OutfitPickerDialog weekday={1} repository={repository} onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "Välj Recent för Måndag" });

    await user.selectOptions(screen.getByRole("combobox", { name: "Sortera Måndag" }), "oldest");

    expect(order()).toEqual([
      "Välj Recent för Måndag",
      "Välj Never för Måndag",
      "Välj Old för Måndag",
    ]);
    expect(screen.getByRole("alert")).toHaveTextContent("Kunde inte ladda senast använd. Försök igen.");
    expect(screen.queryByText("Aldrig använd")).not.toBeInTheDocument();
  });

  it("closes with Escape and with the close control", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const repository = { listOutfits: vi.fn().mockResolvedValue([office]) };
    render(<OutfitPickerDialog weekday={1} repository={repository} onSelect={vi.fn()} onClose={onClose} />);
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Stäng" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("shows an empty state and surfaces a load error", async () => {
    const empty = { listOutfits: vi.fn().mockResolvedValue([]) };
    const { unmount } = render(<OutfitPickerDialog weekday={1} repository={empty} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText("Inga sparade outfits än. Skapa en under Styla.")).toBeInTheDocument();
    unmount();

    const failing = { listOutfits: vi.fn().mockRejectedValue(new Error("Nätverksfel")) };
    render(<OutfitPickerDialog weekday={1} repository={failing} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Nätverksfel");
  });
});
