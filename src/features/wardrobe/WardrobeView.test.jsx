import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WardrobeView } from "./WardrobeView.jsx";

afterEach(cleanup);

const shirt = {
  id: "shirt-1",
  name: "Blue shirt",
  category: "top",
  slot: "top",
  brand: "",
  size: "",
  notes: "",
  colors: ["#336699"],
  tags: ["cotton"],
  cutout_path: "cutouts/shirt-1.png",
  cutoutUrl: "data:image/png;base64,c2hpcnQ=",
  anchor_x: 0.4,
  anchor_y: 0.6,
  scale: 0.75,
  rotation_degrees: -2,
  layer_order: 42,
  status: "active",
};

const jacket = {
  ...shirt,
  id: "jacket-1",
  name: "Brown jacket",
  category: "jacket",
  slot: "outerwear",
  cutout_path: "cutouts/jacket-1.png",
  cutoutUrl: "data:image/png;base64,amFja2V0",
};

const greenTop = { ...shirt, id: "green-top", name: "Green top", colors: ["#4a8c3f"] };
const redTop = { ...shirt, id: "red-top", name: "Red top", colors: ["#c0392b"] };
const redBottom = {
  ...shirt,
  id: "red-bottom",
  name: "Red bottom",
  category: "bottom",
  slot: "bottom",
  colors: ["#c0392b"],
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createRepository(overrides = {}) {
  return {
    listItems: vi.fn().mockResolvedValue([]),
    updateItem: vi.fn(async (item) => item),
    archiveItem: vi.fn(async (id) => ({ id, status: "archived" })),
    restoreItem: vi.fn(),
    createSignedAssetUrls: vi.fn(),
    ...overrides,
  };
}

describe("WardrobeView", () => {
  it("shows a loading state while the repository request is pending", () => {
    const request = deferred();
    const repository = createRepository({ listItems: vi.fn(() => request.promise) });

    render(<WardrobeView repository={repository} />);

    expect(screen.getByText("Laddar garderob")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });

  it("shows an accessible repository error", async () => {
    const repository = createRepository({
      listItems: vi.fn().mockRejectedValue(new Error("Wardrobe service unavailable.")),
    });

    render(<WardrobeView repository={repository} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Wardrobe service unavailable.");
  });

  it("shows a useful empty state", async () => {
    render(<WardrobeView repository={createRepository()} />);

    expect(await screen.findByText("Din garderob är tom.")).toBeInTheDocument();
  });

  it("filters items by category", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt, jacket]),
    });
    render(<WardrobeView repository={repository} />);
    await screen.findByRole("button", { name: "Visa Blue shirt" });

    await user.click(screen.getByRole("button", { name: "Överdelar" }));

    expect(screen.getByRole("button", { name: "Visa Blue shirt" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Visa Brown jacket" })).not.toBeInTheDocument();
  });

  it("keeps signed asset URLs intact on native images", async () => {
    const signedUrl = "https://assets.test/object/sign/cutouts/shirt.png?token=private-token";
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([{ ...shirt, cutoutUrl: signedUrl }]),
    });

    render(<WardrobeView repository={repository} />);

    const itemButton = await screen.findByRole("button", { name: "Visa Blue shirt" });
    expect(itemButton.querySelector("img")).toHaveAttribute("src", signedUrl);
  });

  it("saves editable metadata and preserves placement values", async () => {
    const user = userEvent.setup();
    const savedItem = {
      ...shirt,
      name: "Tailored shirt",
      category: "jacket",
      slot: "outerwear",
      brand: "Acme",
      size: "M",
      notes: "Dry clean",
      colors: ["#112233", "#445566"],
      tags: ["wool", "smart"],
    };
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
      updateItem: vi.fn().mockResolvedValue(savedItem),
    });
    render(<WardrobeView repository={repository} />);
    await user.click(await screen.findByRole("button", { name: "Visa Blue shirt" }));

    expect(screen.getByRole("dialog", { name: "Redigera Blue shirt" })).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Namn"));
    await user.type(screen.getByLabelText("Namn"), "Tailored shirt");
    await user.selectOptions(screen.getByLabelText("Kategori"), "jacket");
    await user.type(screen.getByLabelText("Märke"), "Acme");
    await user.type(screen.getByLabelText("Storlek"), "M");
    await user.type(screen.getByLabelText("Anteckningar"), "Dry clean");
    await user.clear(screen.getByLabelText("Färger"));
    await user.type(screen.getByLabelText("Färger"), "#112233, #445566");
    await user.clear(screen.getByLabelText("Taggar"));
    await user.type(screen.getByLabelText("Taggar"), "wool, smart");
    await user.click(screen.getByRole("button", { name: "Spara" }));

    await waitFor(() => expect(repository.updateItem).toHaveBeenCalledWith({
      ...shirt,
      name: "Tailored shirt",
      category: "jacket",
      brand: "Acme",
      size: "M",
      notes: "Dry clean",
      colors: ["#112233", "#445566"],
      tags: ["wool", "smart"],
    }));
    const updatedButton = await screen.findByRole("button", { name: "Visa Tailored shirt" });
    expect(updatedButton).toBeInTheDocument();
    expect(updatedButton).toHaveFocus();
  });

  it("keeps an item visible until Archive resolves", async () => {
    const user = userEvent.setup();
    const archive = deferred();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
      archiveItem: vi.fn(() => archive.promise),
    });
    render(<WardrobeView repository={repository} />);
    await user.click(await screen.findByRole("button", { name: "Visa Blue shirt" }));

    await user.click(screen.getByRole("button", { name: "Arkivera" }));

    expect(repository.archiveItem).toHaveBeenCalledWith("shirt-1");
    expect(screen.getByRole("button", { name: "Visa Blue shirt", hidden: true })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Redigera Blue shirt" })).toBeInTheDocument();

    await act(async () => archive.resolve({ ...shirt, status: "archived" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Visa Blue shirt", hidden: true })).not.toBeInTheDocument();
    });
  });

  it("keeps an item and shows an alert when Archive fails", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
      archiveItem: vi.fn().mockRejectedValue(new Error("Archive failed.")),
    });
    render(<WardrobeView repository={repository} />);
    await user.click(await screen.findByRole("button", { name: "Visa Blue shirt" }));

    await user.click(screen.getByRole("button", { name: "Arkivera" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Ändringarna sparades inte. Försök igen.");
    expect(screen.getByRole("button", { name: "Visa Blue shirt", hidden: true })).toBeInTheDocument();
  });

  it("moves focus into the editor when it opens", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
    });
    render(<WardrobeView repository={repository} />);

    await user.click(await screen.findByRole("button", { name: "Visa Blue shirt" }));

    expect(screen.getByLabelText("Namn")).toHaveFocus();
  });

  it("closes the editor with Escape when no action is pending", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
    });
    render(<WardrobeView repository={repository} />);
    await user.click(await screen.findByRole("button", { name: "Visa Blue shirt" }));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("wraps Tab and Shift+Tab within the editor", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
    });
    render(<WardrobeView repository={repository} />);
    await user.click(await screen.findByRole("button", { name: "Visa Blue shirt" }));
    const closeButton = screen.getByRole("button", { name: "Stäng redigering" });
    const saveButton = screen.getByRole("button", { name: "Spara" });

    closeButton.focus();
    await user.tab({ shift: true });
    expect(saveButton).toHaveFocus();

    await user.tab();
    expect(closeButton).toHaveFocus();
  });

  it("restores focus to the invoking gallery item after close", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
    });
    render(<WardrobeView repository={repository} />);
    const invokingButton = await screen.findByRole("button", { name: "Visa Blue shirt" });
    await user.click(invokingButton);

    await user.click(screen.getByRole("button", { name: "Stäng redigering" }));

    expect(invokingButton).toHaveFocus();
  });

  it("hides and inerts the gallery only while the editor is open", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
    });
    render(<WardrobeView repository={repository} />);
    const gallery = screen.getByRole("main");
    await user.click(await screen.findByRole("button", { name: "Visa Blue shirt" }));

    expect(gallery).toHaveAttribute("aria-hidden", "true");
    expect(gallery).toHaveAttribute("inert");

    await user.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(gallery).not.toHaveAttribute("aria-hidden");
    expect(gallery).not.toHaveAttribute("inert");
    await user.click(screen.getByRole("button", { name: "Överdelar" }));
    expect(screen.getByRole("button", { name: "Överdelar" })).toHaveAttribute("aria-pressed", "true");
  });

  it("locks body scroll and restores the prior value on StrictMode cleanup", async () => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "clip";
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
    });

    try {
      const view = render(
        <StrictMode>
          <WardrobeView repository={repository} />
        </StrictMode>,
      );
      await user.click(await screen.findByRole("button", { name: "Visa Blue shirt" }));

      expect(document.body.style.overflow).toBe("hidden");

      view.unmount();
      expect(document.body.style.overflow).toBe("clip");
    } finally {
      document.body.style.overflow = previousOverflow;
    }
  });

  it("keeps the editor open during a pending save and reports rejection", async () => {
    const user = userEvent.setup();
    const saveRequest = deferred();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
      updateItem: vi.fn(() => saveRequest.promise),
    });
    render(<WardrobeView repository={repository} />);
    await user.click(await screen.findByRole("button", { name: "Visa Blue shirt" }));

    await user.click(screen.getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(repository.updateItem).toHaveBeenCalled());
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Redigera Blue shirt" })).toBeInTheDocument();

    await act(async () => saveRequest.reject(new Error("Save failed.")));

    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed.");
    expect(screen.getByRole("button", { name: "Visa Blue shirt", hidden: true })).toBeInTheDocument();
  });

  it.each([
    ["next", "Blue shirt", "Brown jacket"],
    ["previous", "Brown jacket", "Blue shirt"],
  ])("moves focus to the logical %s item after Archive", async (_direction, selectedName, expectedName) => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt, jacket]),
    });
    render(<WardrobeView repository={repository} />);
    await user.click(await screen.findByRole("button", { name: `Visa ${selectedName}` }));

    await user.click(screen.getByRole("button", { name: "Arkivera" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: `Visa ${expectedName}` })).toHaveFocus();
    });
  });

  it("falls back to All after archiving the only item in a now-empty category", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
    });
    render(<WardrobeView repository={repository} />);
    await screen.findByRole("button", { name: "Visa Blue shirt" });
    await user.click(screen.getByRole("button", { name: "Överdelar" }));
    await user.click(screen.getByRole("button", { name: "Visa Blue shirt" }));

    await user.click(screen.getByRole("button", { name: "Arkivera" }));

    // The now-empty "Överdelar" chip disappears, so focus lands on "Alla".
    await waitFor(() => expect(screen.getByRole("button", { name: "Alla" })).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Överdelar" })).not.toBeInTheDocument();
  });

  it("ignores a stale initial load after the repository changes", async () => {
    const staleRequest = deferred();
    const firstRepository = createRepository({
      listItems: vi.fn(() => staleRequest.promise),
    });
    const secondRepository = createRepository({
      listItems: vi.fn().mockResolvedValue([jacket]),
    });
    const view = render(<WardrobeView repository={firstRepository} />);

    view.rerender(<WardrobeView repository={secondRepository} />);
    expect(await screen.findByRole("button", { name: "Visa Brown jacket" })).toBeInTheDocument();

    await act(async () => staleRequest.resolve([shirt]));

    expect(screen.queryByRole("button", { name: "Visa Blue shirt" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visa Brown jacket" })).toBeInTheDocument();
  });

  it("hides category chips that hold no garments", async () => {
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt, jacket]),
    });
    render(<WardrobeView repository={repository} />);
    await screen.findByRole("button", { name: "Visa Blue shirt" });

    expect(screen.getByRole("button", { name: "Alla" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Överdelar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jackor" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Klänningar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skor" })).not.toBeInTheDocument();
  });

  it("shows the colour filter only when at least two families exist", async () => {
    const single = createRepository({ listItems: vi.fn().mockResolvedValue([shirt]) });
    const view = render(<WardrobeView repository={single} />);
    await screen.findByRole("button", { name: "Visa Blue shirt" });
    expect(screen.queryByRole("group", { name: "Filtrera på färg" })).not.toBeInTheDocument();
    view.unmount();

    const multi = createRepository({ listItems: vi.fn().mockResolvedValue([greenTop, redTop]) });
    render(<WardrobeView repository={multi} />);
    await screen.findByRole("button", { name: "Visa Green top" });
    expect(screen.getByRole("group", { name: "Filtrera på färg" })).toBeInTheDocument();
  });

  it("filters by colour family and combines with the category filter", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([greenTop, redTop, redBottom]),
    });
    render(<WardrobeView repository={repository} />);
    await screen.findByRole("button", { name: "Visa Green top" });

    await user.click(screen.getByRole("button", { name: "Filtrera på färg Röd" }));
    expect(screen.getByRole("button", { name: "Visa Red top" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visa Red bottom" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Visa Green top" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Underdelar" }));
    expect(screen.getByRole("button", { name: "Visa Red bottom" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Visa Red top" })).not.toBeInTheDocument();

    // Toggling the colour off keeps the category filter and restores its items.
    await user.click(screen.getByRole("button", { name: "Filtrera på färg Röd" }));
    expect(screen.getByRole("button", { name: "Visa Red bottom" })).toBeInTheDocument();
  });
});
