import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.jsx";
import { HistoryView } from "./HistoryView.jsx";
import { WearDialog } from "./WearDialog.jsx";

afterEach(cleanup);

const top = {
  id: "item-a", name: "Blue top", category: "top", slot: "top", status: "active",
  cutoutUrl: "/top.png", anchor_x: 0.5, anchor_y: 0.35, scale: 0.5,
  rotation_degrees: 0, layer_order: 20, brand: "", size: "", notes: "",
  colors: [], tags: [],
};
const bottom = {
  ...top, id: "item-b", name: "Black trousers", category: "bottom", slot: "bottom",
  cutoutUrl: "/bottom.png", anchor_y: 0.6, layer_order: 30,
};

function localDateValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function appRepository(overrides = {}) {
  return {
    listItems: vi.fn().mockResolvedValue([top, bottom]),
    updateItem: vi.fn(async (item) => item),
    archiveItem: vi.fn().mockResolvedValue(null),
    restoreItem: vi.fn(),
    createSignedAssetUrls: vi.fn(),
    listOutfits: vi.fn().mockResolvedValue([]),
    saveOutfit: vi.fn(),
    recordWear: vi.fn().mockResolvedValue("wear-1"),
    listWearHistory: vi.fn().mockResolvedValue([]),
    listItemsWithLastWorn: vi.fn().mockResolvedValue([top, bottom]),
    ...overrides,
  };
}

describe("WearDialog", () => {
  it("defaults to today and records every selected garment", async () => {
    const user = userEvent.setup();
    const onRecord = vi.fn().mockResolvedValue("wear-1");
    const onClose = vi.fn();
    render(
      <WearDialog
        items={[top, bottom]}
        outfitId="outfit-a"
        onRecord={onRecord}
        onClose={onClose}
      />,
    );

    const today = localDateValue();
    expect(screen.getByLabelText("Buren den")).toHaveValue(today);
    await user.click(screen.getByRole("button", { name: "Registrera" }));

    expect(onRecord).toHaveBeenCalledWith({
      itemIds: ["item-a", "item-b"],
      wornAt: new Date(`${today}T12:00:00`).toISOString(),
      outfitId: "outfit-a",
      notes: null,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("preserves the backfilled date and selection when recording fails", async () => {
    const user = userEvent.setup();
    const onRecord = vi.fn().mockRejectedValue(new Error("Offline"));
    render(<WearDialog items={[top, bottom]} onRecord={onRecord} onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText("Buren den"));
    await user.type(screen.getByLabelText("Buren den"), "2026-06-02");
    await user.click(screen.getByRole("button", { name: "Registrera" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ändringarna sparades inte. Försök igen.");
    expect(screen.getByRole("dialog", { name: "Registrera användning" })).toBeInTheDocument();
    expect(screen.getByLabelText("Buren den")).toHaveValue("2026-06-02");
    expect(screen.getByText("Blue top")).toBeInTheDocument();
    expect(screen.getByText("Black trousers")).toBeInTheDocument();
  });

  it("traps focus, closes with Escape, and restores its connected trigger", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open wear</button>
          {open && (
            <WearDialog
              items={[top]}
              onRecord={vi.fn()}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open wear" });
    await user.click(trigger);
    expect(screen.getByLabelText("Buren den")).toHaveFocus();

    const close = screen.getByRole("button", { name: "Stäng" });
    const record = screen.getByRole("button", { name: "Registrera" });
    close.focus();
    await user.tab({ shift: true });
    expect(record).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Registrera användning" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("HistoryView", () => {
  it("shows newest events first using saved item rows, including archived names", async () => {
    const repository = appRepository({
      listWearHistory: vi.fn().mockResolvedValue([
        {
          id: "older", worn_at: "2026-07-10T12:00:00.000Z", outfit: null,
          items: [{ id: "old-top", name: "Snapshot top", status: "active" }],
        },
        {
          id: "newer", worn_at: "2026-07-17T12:00:00.000Z",
          outfit: { id: "outfit-a", name: "Office day" },
          items: [{ id: "archived", name: "Old trousers", status: "archived" }],
        },
      ]),
    });
    render(<HistoryView active repository={repository} />);

    const entries = await screen.findAllByRole("article");
    expect(within(entries[0]).getByText("Old trousers")).toBeInTheDocument();
    expect(within(entries[0]).getByText("Arkiverat")).toBeInTheDocument();
    expect(within(entries[0]).getByText("Office day")).toBeInTheDocument();
    expect(within(entries[1]).getByText("Snapshot top")).toBeInTheDocument();
    expect(screen.queryByText("Updated top")).not.toBeInTheDocument();
  });
});

describe("wear entry points", () => {
  it("marks one garment worn from its editor", async () => {
    const user = userEvent.setup();
    const repository = appRepository();
    render(<App repository={repository} />);

    await user.click(await screen.findByRole("button", { name: "Visa Blue top" }));
    const markWorn = screen.getByRole("button", { name: "Markera buren" });
    await user.click(markWorn);
    expect(screen.getByRole("dialog", { name: "Redigera Blue top", hidden: true }))
      .toBeInTheDocument();
    const background = screen.getByTestId("wearit-background");
    expect(background).toHaveAttribute("aria-hidden", "true");
    expect(background).toHaveAttribute("inert");
    await user.click(screen.getByRole("button", { name: "Registrera" }));

    expect(repository.recordWear).toHaveBeenCalledWith(expect.objectContaining({
      itemIds: ["item-a"],
      outfitId: null,
    }));
    expect(markWorn).toHaveFocus();
  });

  it("records the current mannequin selection with loaded outfit context", async () => {
    const user = userEvent.setup();
    const outfit = {
      id: "outfit-a", name: "Office day", items: [top, bottom],
      thumbnailUrl: "/office.webp", needs_attention: false,
    };
    const repository = appRepository({
      listOutfits: vi.fn().mockResolvedValue([outfit]),
    });
    render(<App repository={repository} />);

    await screen.findByRole("button", { name: "Visa Blue top" });
    await user.click(screen.getByRole("button", { name: "Outfits" }));
    await user.click(await screen.findByRole("button", { name: "Ladda Office day" }));
    await user.click(screen.getByRole("button", { name: "Bär outfit" }));
    await user.click(screen.getByRole("button", { name: "Registrera" }));

    expect(repository.recordWear).toHaveBeenCalledWith(expect.objectContaining({
      itemIds: ["item-a", "item-b"],
      outfitId: "outfit-a",
    }));
  });

  it("keeps the garment selected and reports a stable retry message when archive fails", async () => {
    const user = userEvent.setup();
    const repository = appRepository({
      archiveItem: vi.fn().mockRejectedValue(new Error("network internals")),
    });
    render(<App repository={repository} />);
    await user.click(await screen.findByRole("button", { name: "Visa Blue top" }));

    await user.click(screen.getByRole("button", { name: "Arkivera" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ändringarna sparades inte. Försök igen.");
    expect(screen.getByRole("dialog", { name: "Redigera Blue top" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Avbryt" }));
    await user.click(screen.getByRole("button", { name: "Dress" }));
    expect(screen.getByRole("button", { name: "Välj Blue top" })).toBeInTheDocument();
  });

  it("refreshes wardrobe data after a successful archive", async () => {
    const user = userEvent.setup();
    const repository = appRepository({
      listItemsWithLastWorn: vi.fn()
        .mockResolvedValueOnce([top, bottom])
        .mockResolvedValueOnce([bottom]),
    });
    render(<App repository={repository} />);
    await user.click(await screen.findByRole("button", { name: "Visa Blue top" }));

    await user.click(screen.getByRole("button", { name: "Arkivera" }));

    await waitFor(() => expect(repository.listItemsWithLastWorn).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Visa Blue top" })).not.toBeInTheDocument();
  });
});
