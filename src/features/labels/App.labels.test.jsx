import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.jsx";

afterEach(cleanup);

const SUMMER = "s-summer";
const WINTER = "s-winter";
const RAINY = "t-rainy";

const labels = [
  { id: SUMMER, kind: "season", seasonKey: "summer", name: "Summer", locked: true },
  { id: WINTER, kind: "season", seasonKey: "winter", name: "Winter", locked: true },
  { id: RAINY, kind: "theme", seasonKey: null, name: "Rainy day", locked: false },
];

const baseItems = [
  { id: "top-1", name: "Summer top", category: "top", slot: "top", cutoutUrl: "/t.png", colors: ["#4a8c3f"], labelIds: [SUMMER, RAINY] },
  { id: "bottom-1", name: "Winter bottom", category: "bottom", slot: "bottom", cutoutUrl: "/b.png", colors: ["#2f5fb0"], labelIds: [WINTER] },
  { id: "shoes-1", name: "Plain shoes", category: "shoes", slot: "shoes", cutoutUrl: "/s.png", colors: ["#111111"], labelIds: [] },
];

function mockRepo(overrides = {}) {
  return {
    listItems: vi.fn().mockResolvedValue(baseItems.map((item) => ({ ...item }))),
    listOutfits: vi.fn().mockResolvedValue([]),
    listWearHistory: vi.fn().mockResolvedValue([]),
    listLabels: vi.fn().mockResolvedValue(labels),
    updateItem: vi.fn(async (item) => item),
    archiveItem: vi.fn(),
    restoreItem: vi.fn(),
    createTheme: vi.fn(),
    renameTheme: vi.fn(),
    deleteTheme: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const wardrobeFilter = { name: "Filter – Garderob" };

describe("App label integration", () => {
  it("shows both labeled and unlabeled clothes under All", async () => {
    render(<App repository={mockRepo()} />);
    await screen.findByRole("button", { name: "Visa Summer top" });

    expect(screen.getByRole("button", { name: "Visa Winter bottom" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visa Plain shoes" })).toBeInTheDocument();
  });

  it("combines the label filter with the category filter using AND", async () => {
    const user = userEvent.setup();
    render(<App repository={mockRepo()} />);
    await screen.findByRole("button", { name: "Visa Summer top" });

    await user.click(screen.getByRole("button", wardrobeFilter));
    await user.click(screen.getByRole("checkbox", { name: "Sommar" }));

    expect(screen.getByRole("button", { name: "Visa Summer top" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Visa Winter bottom" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Visa Plain shoes" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Underdelar" }));
    // Summer AND bottom-category matches nothing (the summer item is a top).
    expect(screen.queryByRole("button", { name: "Visa Summer top" })).not.toBeInTheDocument();
    expect(screen.getByText("Inga plagg matchar filtret.")).toBeInTheDocument();
  });

  it("returns the filter to All on remount", async () => {
    const user = userEvent.setup();
    const view = render(<App repository={mockRepo()} />);
    await screen.findByRole("button", { name: "Visa Summer top" });
    await user.click(screen.getByRole("button", wardrobeFilter));
    await user.click(screen.getByRole("checkbox", { name: "Sommar" }));
    expect(screen.queryByRole("button", { name: "Visa Winter bottom" })).not.toBeInTheDocument();

    view.unmount();
    render(<App repository={mockRepo()} />);
    await screen.findByRole("button", { name: "Visa Summer top" });
    expect(screen.getByRole("button", { name: "Visa Winter bottom" })).toBeInTheDocument();
  });

  it("loads an item's labels, auto-selects a created theme, and saves the full set", async () => {
    const user = userEvent.setup();
    const updateItem = vi.fn(async (item) => item);
    const createTheme = vi.fn().mockResolvedValue({
      id: "t-new", kind: "theme", seasonKey: null, name: "Regn", locked: false,
    });
    render(<App repository={mockRepo({ updateItem, createTheme })} />);

    await user.click(await screen.findByRole("button", { name: "Visa Summer top" }));
    expect(screen.getByRole("checkbox", { name: "Sommar" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Rainy day" })).toBeChecked();

    await user.type(screen.getByLabelText("Nytt tema"), "Regn");
    await user.click(screen.getByRole("button", { name: "Skapa" }));
    expect(createTheme).toHaveBeenCalledWith("Regn");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Regn" })).toBeChecked());

    await user.click(screen.getByRole("checkbox", { name: "Vinter" }));
    await user.click(screen.getByRole("button", { name: "Spara" }));

    await waitFor(() => expect(updateItem).toHaveBeenCalled());
    const payload = updateItem.mock.calls.at(-1)[0];
    expect(payload.labelIds).toEqual(expect.arrayContaining([SUMMER, RAINY, "t-new", WINTER]));
  });

  it("blocks item saving when labels could not be loaded", async () => {
    const user = userEvent.setup();
    render(<App repository={mockRepo({ listLabels: vi.fn().mockRejectedValue(new Error("Etiketter nere.")) })} />);

    await user.click(await screen.findByRole("button", { name: "Visa Summer top" }));

    expect(screen.getByRole("button", { name: "Spara" })).toBeDisabled();
    expect(screen.getByText("Etiketter nere.")).toBeInTheDocument();
  });

  it("sanitizes the active filter and preserves the item when its theme is deleted", async () => {
    const user = userEvent.setup();
    const deleteTheme = vi.fn().mockResolvedValue(undefined);
    render(<App repository={mockRepo({ deleteTheme })} />);
    await screen.findByRole("button", { name: "Visa Summer top" });

    // Filter to the theme so only the labeled item shows.
    await user.click(screen.getByRole("button", wardrobeFilter));
    await user.click(screen.getByRole("checkbox", { name: "Rainy day" }));
    expect(screen.queryByRole("button", { name: "Visa Winter bottom" })).not.toBeInTheDocument();

    // Delete the theme from the item editor.
    await user.click(screen.getByRole("button", { name: "Visa Summer top" }));
    await user.click(screen.getByRole("button", { name: "Ta bort Rainy day" }));
    await user.click(screen.getByRole("button", { name: "Bekräfta borttagning" }));
    expect(deleteTheme).toHaveBeenCalledWith(RAINY);

    await user.click(screen.getByRole("button", { name: "Avbryt" }));
    // The filter was sanitized, so the previously hidden items return and nothing was deleted.
    await waitFor(() => expect(screen.getByRole("button", { name: "Visa Winter bottom" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Visa Summer top" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visa Plain shoes" })).toBeInTheDocument();
  });
});
