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

// green + red + blue keeps three colour families available so the Färg group renders.
const greenSummerRain = { id: "top-1", name: "Green rain top", category: "top", slot: "top", cutoutUrl: "/1.png", colors: ["#4a8c3f"], labelIds: [SUMMER, RAINY] };
const greenSummer = { id: "top-2", name: "Green summer top", category: "top", slot: "top", cutoutUrl: "/2.png", colors: ["#4a8c3f"], labelIds: [SUMMER] };
const redRain = { id: "top-3", name: "Red rain top", category: "top", slot: "top", cutoutUrl: "/3.png", colors: ["#c0392b"], labelIds: [SUMMER, RAINY] };
const blueShoes = { id: "shoes-1", name: "Blue shoes", category: "shoes", slot: "shoes", cutoutUrl: "/4.png", colors: ["#2f5fb0"], labelIds: [] };

const baseItems = [greenSummerRain, greenSummer, redRain, blueShoes];

function mockRepo(overrides = {}) {
  const items = (overrides.items ?? baseItems).map((item) => ({ ...item }));
  return {
    listItems: vi.fn().mockResolvedValue(items),
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

describe("App unified filter integration", () => {
  it("shows labeled and unlabeled clothes under the initial All", async () => {
    render(<App repository={mockRepo()} />);
    await screen.findByRole("button", { name: "Visa Green rain top" });

    expect(screen.getByRole("button", { name: "Visa Green summer top" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visa Red rain top" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visa Blue shoes" })).toBeInTheDocument();
  });

  it("intersects Colour, Season, and Theme with AND", async () => {
    const user = userEvent.setup();
    render(<App repository={mockRepo()} />);
    await screen.findByRole("button", { name: "Visa Green rain top" });

    await user.click(screen.getByRole("button", wardrobeFilter));
    await user.click(screen.getByRole("checkbox", { name: "Grön" }));
    await user.click(screen.getByRole("checkbox", { name: "Sommar" }));
    await user.click(screen.getByRole("checkbox", { name: "Rainy day" }));

    expect(screen.getByRole("button", { name: "Visa Green rain top" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Visa Green summer top" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Visa Red rain top" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Visa Blue shoes" })).not.toBeInTheDocument();
  });

  it("resets Colour/Season/Theme to All on remount", async () => {
    const user = userEvent.setup();
    const view = render(<App repository={mockRepo()} />);
    await screen.findByRole("button", { name: "Visa Green rain top" });
    await user.click(screen.getByRole("button", wardrobeFilter));
    await user.click(screen.getByRole("checkbox", { name: "Grön" }));
    expect(screen.queryByRole("button", { name: "Visa Blue shoes" })).not.toBeInTheDocument();

    view.unmount();
    render(<App repository={mockRepo()} />);
    await screen.findByRole("button", { name: "Visa Green rain top" });
    expect(screen.getByRole("button", { name: "Visa Blue shoes" })).toBeInTheDocument();
  });

  it("resets all three selections when the repository is replaced", async () => {
    const user = userEvent.setup();
    const repoB = mockRepo({
      items: [{ id: "b-1", name: "Repo B red top", category: "top", slot: "top", cutoutUrl: "/b.png", colors: ["#c0392b"], labelIds: [] }],
    });
    const view = render(<App repository={mockRepo()} />);
    await screen.findByRole("button", { name: "Visa Green rain top" });
    await user.click(screen.getByRole("button", wardrobeFilter));
    await user.click(screen.getByRole("checkbox", { name: "Grön" }));
    await user.click(screen.getByRole("checkbox", { name: "Sommar" }));

    view.rerender(<App repository={repoB} />);

    // The red, unlabeled Repo B item would be hidden under the prior Green+Summer filter.
    expect(await screen.findByRole("button", { name: "Visa Repo B red top" })).toBeInTheDocument();
  });

  it("keeps the selected Colour when an active theme is deleted", async () => {
    const user = userEvent.setup();
    const deleteTheme = vi.fn().mockResolvedValue(undefined);
    render(<App repository={mockRepo({ deleteTheme })} />);
    await screen.findByRole("button", { name: "Visa Green rain top" });

    // Green + Rainy day hides the green-but-not-rainy top and the red rainy top.
    await user.click(screen.getByRole("button", wardrobeFilter));
    await user.click(screen.getByRole("checkbox", { name: "Grön" }));
    await user.click(screen.getByRole("checkbox", { name: "Rainy day" }));
    expect(screen.queryByRole("button", { name: "Visa Green summer top" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Visa Red rain top" })).not.toBeInTheDocument();

    // Delete the Rainy day theme from the item editor.
    await user.click(screen.getByRole("button", { name: "Visa Green rain top" }));
    await user.click(screen.getByRole("button", { name: "Ta bort Rainy day" }));
    await user.click(screen.getByRole("button", { name: "Bekräfta borttagning" }));
    expect(deleteTheme).toHaveBeenCalledWith(RAINY);
    await user.click(screen.getByRole("button", { name: "Avbryt" }));

    // The theme selection is sanitized away, but Green still filters out the red top.
    await waitFor(() => expect(screen.getByRole("button", { name: "Visa Green summer top" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Visa Red rain top" })).not.toBeInTheDocument();
  });

  it("still filters by Colour when label loading fails", async () => {
    const user = userEvent.setup();
    render(<App repository={mockRepo({ listLabels: vi.fn().mockRejectedValue(new Error("Etiketter nere.")) })} />);
    await screen.findByRole("button", { name: "Visa Green rain top" });

    await user.click(screen.getByRole("button", wardrobeFilter));
    expect(screen.getByRole("alert")).toHaveTextContent("Etiketter nere.");
    await user.click(screen.getByRole("checkbox", { name: "Grön" }));

    expect(screen.getByRole("button", { name: "Visa Green rain top" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visa Green summer top" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Visa Red rain top" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Visa Blue shoes" })).not.toBeInTheDocument();
  });
});
