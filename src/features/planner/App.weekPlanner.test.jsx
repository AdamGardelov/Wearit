import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.jsx";

const top = { id: "item-a", name: "Blue top", category: "top", slot: "top", status: "active", cutoutUrl: "/a.png", colors: [], tags: [], layer_order: 20 };
const bottom = { id: "item-b", name: "Black trousers", category: "bottom", slot: "bottom", status: "active", cutoutUrl: "/b.png", colors: [], tags: [], layer_order: 30 };
const office = { id: "outfit-a", name: "Office day", items: [top, bottom], thumbnailUrl: "/office.webp", needs_attention: false };

function emptyPlan() {
  return [1, 2, 3, 4, 5].map((weekday) => ({ weekday, outfitId: null, outfit: null }));
}

function mondayPlan() {
  return [1, 2, 3, 4, 5].map((weekday) => (
    weekday === 1
      ? { weekday, outfitId: office.id, outfit: office }
      : { weekday, outfitId: null, outfit: null }
  ));
}

function weekPlannerRepo(overrides = {}) {
  return {
    listItems: vi.fn().mockResolvedValue([top, bottom]),
    listItemsWithLastWorn: vi.fn().mockResolvedValue([top, bottom]),
    updateItem: vi.fn(async (item) => item),
    archiveItem: vi.fn(),
    restoreItem: vi.fn(),
    createSignedAssetUrls: vi.fn(),
    listLabels: vi.fn().mockResolvedValue([]),
    listOutfits: vi.fn().mockResolvedValue([office]),
    saveOutfit: vi.fn(),
    deleteOutfit: vi.fn(),
    recordWear: vi.fn().mockResolvedValue("wear-1"),
    listWearHistory: vi.fn().mockResolvedValue([]),
    listWeeklyPlan: vi.fn(),
    setWeeklyPlanSlot: vi.fn().mockResolvedValue({ weekday: 1, outfit_id: office.id }),
    clearWeeklyPlanSlot: vi.fn().mockResolvedValue(null),
    clearWeeklyPlan: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("App weekly planner integration", () => {
  beforeEach(() => {
    // Fake only Date so userEvent's real timers keep working. 2026-07-13 is a Monday.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 13, 9, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("plans Monday, wears the exact saved outfit, and keeps the slot", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const repository = weekPlannerRepo();
    repository.listWeeklyPlan
      .mockResolvedValueOnce(emptyPlan())
      .mockResolvedValue(mondayPlan());

    render(<App repository={repository} />);
    await screen.findByRole("button", { name: "Visa Blue top" });

    // Navigate to the new primary Vecka tab.
    await user.click(screen.getByRole("button", { name: "Vecka" }));

    // Plan Monday from the picker.
    await user.click(await screen.findByRole("button", { name: "Välj outfit för Måndag" }));
    await user.click(await screen.findByRole("button", { name: "Välj Office day för Måndag" }));

    await waitFor(() => expect(repository.setWeeklyPlanSlot)
      .toHaveBeenCalledWith({ weekday: 1, outfitId: "outfit-a" }));

    // Today is Monday, so only Monday exposes Bär idag.
    const wearToday = await screen.findByRole("button", { name: "Bär Office day idag" });

    await user.click(wearToday);
    await user.click(await screen.findByRole("button", { name: "Registrera" }));

    // The exact saved outfit and its items are recorded through the existing wear flow.
    await waitFor(() => expect(repository.recordWear).toHaveBeenCalledWith(expect.objectContaining({
      itemIds: ["item-a", "item-b"],
      outfitId: "outfit-a",
    })));

    // Planning never mutates the plan: the Monday slot remains populated after wearing.
    expect(await screen.findByRole("button", { name: "Öppna Office day" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bär Office day idag" })).toBeInTheDocument();
  });
});
