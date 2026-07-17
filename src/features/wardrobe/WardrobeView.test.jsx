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

    expect(screen.getByText("Loading wardrobe")).toBeInTheDocument();
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

    expect(await screen.findByText("Your wardrobe is empty.")).toBeInTheDocument();
  });

  it("filters items by category", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt, jacket]),
    });
    render(<WardrobeView repository={repository} />);
    await screen.findByRole("button", { name: "View Blue shirt" });

    await user.click(screen.getByRole("button", { name: "Tops" }));

    expect(screen.getByRole("button", { name: "View Blue shirt" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View Brown jacket" })).not.toBeInTheDocument();
  });

  it("keeps signed asset URLs intact on native images", async () => {
    const signedUrl = "https://assets.test/object/sign/cutouts/shirt.png?token=private-token";
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([{ ...shirt, cutoutUrl: signedUrl }]),
    });

    render(<WardrobeView repository={repository} />);

    const itemButton = await screen.findByRole("button", { name: "View Blue shirt" });
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
    await user.click(await screen.findByRole("button", { name: "View Blue shirt" }));

    expect(screen.getByRole("dialog", { name: "Edit Blue shirt" })).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Tailored shirt");
    await user.selectOptions(screen.getByLabelText("Category"), "jacket");
    await user.type(screen.getByLabelText("Brand"), "Acme");
    await user.type(screen.getByLabelText("Size"), "M");
    await user.type(screen.getByLabelText("Notes"), "Dry clean");
    await user.clear(screen.getByLabelText("Colors"));
    await user.type(screen.getByLabelText("Colors"), "#112233, #445566");
    await user.clear(screen.getByLabelText("Tags"));
    await user.type(screen.getByLabelText("Tags"), "wool, smart");
    await user.click(screen.getByRole("button", { name: "Save" }));

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
    const updatedButton = await screen.findByRole("button", { name: "View Tailored shirt" });
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
    await user.click(await screen.findByRole("button", { name: "View Blue shirt" }));

    await user.click(screen.getByRole("button", { name: "Archive" }));

    expect(repository.archiveItem).toHaveBeenCalledWith("shirt-1");
    expect(screen.getByRole("button", { name: "View Blue shirt", hidden: true })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Edit Blue shirt" })).toBeInTheDocument();

    await act(async () => archive.resolve({ ...shirt, status: "archived" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "View Blue shirt", hidden: true })).not.toBeInTheDocument();
    });
  });

  it("keeps an item and shows an alert when Archive fails", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
      archiveItem: vi.fn().mockRejectedValue(new Error("Archive failed.")),
    });
    render(<WardrobeView repository={repository} />);
    await user.click(await screen.findByRole("button", { name: "View Blue shirt" }));

    await user.click(screen.getByRole("button", { name: "Archive" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Archive failed.");
    expect(screen.getByRole("button", { name: "View Blue shirt", hidden: true })).toBeInTheDocument();
  });

  it("moves focus into the editor when it opens", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
    });
    render(<WardrobeView repository={repository} />);

    await user.click(await screen.findByRole("button", { name: "View Blue shirt" }));

    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  it("closes the editor with Escape when no action is pending", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
    });
    render(<WardrobeView repository={repository} />);
    await user.click(await screen.findByRole("button", { name: "View Blue shirt" }));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("wraps Tab and Shift+Tab within the editor", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
    });
    render(<WardrobeView repository={repository} />);
    await user.click(await screen.findByRole("button", { name: "View Blue shirt" }));
    const closeButton = screen.getByRole("button", { name: "Close editor" });
    const saveButton = screen.getByRole("button", { name: "Save" });

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
    const invokingButton = await screen.findByRole("button", { name: "View Blue shirt" });
    await user.click(invokingButton);

    await user.click(screen.getByRole("button", { name: "Close editor" }));

    expect(invokingButton).toHaveFocus();
  });

  it("hides and inerts the gallery only while the editor is open", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
    });
    render(<WardrobeView repository={repository} />);
    const gallery = screen.getByRole("main");
    await user.click(await screen.findByRole("button", { name: "View Blue shirt" }));

    expect(gallery).toHaveAttribute("aria-hidden", "true");
    expect(gallery).toHaveAttribute("inert");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(gallery).not.toHaveAttribute("aria-hidden");
    expect(gallery).not.toHaveAttribute("inert");
    await user.click(screen.getByRole("button", { name: "Tops" }));
    expect(screen.getByRole("button", { name: "Tops" })).toHaveAttribute("aria-pressed", "true");
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
      await user.click(await screen.findByRole("button", { name: "View Blue shirt" }));

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
    await user.click(await screen.findByRole("button", { name: "View Blue shirt" }));

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(repository.updateItem).toHaveBeenCalled());
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Edit Blue shirt" })).toBeInTheDocument();

    await act(async () => saveRequest.reject(new Error("Save failed.")));

    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed.");
    expect(screen.getByRole("button", { name: "View Blue shirt", hidden: true })).toBeInTheDocument();
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
    await user.click(await screen.findByRole("button", { name: `View ${selectedName}` }));

    await user.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: `View ${expectedName}` })).toHaveFocus();
    });
  });

  it("moves focus to the active category after archiving the only visible item", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listItems: vi.fn().mockResolvedValue([shirt]),
    });
    render(<WardrobeView repository={repository} />);
    const topsFilter = screen.getByRole("button", { name: "Tops" });
    await user.click(topsFilter);
    await user.click(await screen.findByRole("button", { name: "View Blue shirt" }));

    await user.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(topsFilter).toHaveFocus());
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
    expect(await screen.findByRole("button", { name: "View Brown jacket" })).toBeInTheDocument();

    await act(async () => staleRequest.resolve([shirt]));

    expect(screen.queryByRole("button", { name: "View Blue shirt" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View Brown jacket" })).toBeInTheDocument();
  });
});
