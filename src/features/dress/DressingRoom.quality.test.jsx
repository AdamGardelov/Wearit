import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.jsx";
import { WardrobeView } from "../wardrobe/WardrobeView.jsx";
import { DressingRoom } from "./DressingRoom.jsx";

afterEach(cleanup);

const top = {
  id: "top-1",
  name: "Blue top",
  category: "top",
  slot: "top",
  brand: "",
  size: "",
  notes: "",
  colors: [],
  tags: [],
  cutoutUrl: "/top.png",
  anchor_x: 0.5,
  anchor_y: 0.34,
  scale: 0.52,
  rotation_degrees: 0,
  layer_order: 20,
};
const bottom = {
  ...top,
  id: "bottom-1",
  name: "Black trousers",
  category: "bottom",
  slot: "bottom",
  cutoutUrl: "/bottom.png",
  layer_order: 30,
};
const repositoryBItem = {
  ...top,
  id: "jacket-b",
  name: "Repository B jacket",
  category: "jacket",
  slot: "outerwear",
  cutoutUrl: "/repository-b.png",
  layer_order: 40,
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

function repository(listItems) {
  return {
    listItems,
    updateItem: vi.fn(async (item) => item),
    archiveItem: vi.fn(async (id) => ({ id, status: "archived" })),
    restoreItem: vi.fn(),
    createSignedAssetUrls: vi.fn(),
  };
}

function selectButton(name) {
  return screen.getByRole("button", { name: `Select ${name}` });
}

describe("DressingRoom live reconciliation", () => {
  it("immediately removes archived selections from rendering and actions", async () => {
    const user = userEvent.setup();
    const onWear = vi.fn();
    const view = render(<DressingRoom items={[top, bottom]} onWear={onWear} />);
    await user.click(selectButton("Blue top"));
    await user.click(selectButton("Black trousers"));

    view.rerender(<DressingRoom items={[bottom]} onWear={onWear} />);

    expect(screen.queryByRole("img", { name: "Blue top" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save outfit" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Wear outfit" }));
    expect(onWear).toHaveBeenLastCalledWith([bottom]);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("img", { name: "Blue top" })).not.toBeInTheDocument();
  });

  it("rekeys edited items and keeps selection plus undo compatible", async () => {
    const user = userEvent.setup();
    const view = render(<DressingRoom items={[top, bottom]} />);
    await user.click(selectButton("Blue top"));
    await user.click(selectButton("Black trousers"));
    const editedDress = {
      ...top,
      name: "Updated silk dress",
      category: "dress",
      slot: "dress",
      cutoutUrl: "/updated-dress.png",
      layer_order: 25,
    };

    view.rerender(<DressingRoom items={[editedDress, bottom, repositoryBItem]} />);

    expect(screen.getByRole("img", { name: "Updated silk dress" }))
      .toHaveAttribute("src", "/updated-dress.png");
    expect(screen.queryByRole("img", { name: "Black trousers" })).not.toBeInTheDocument();
    await user.click(selectButton("Repository B jacket"));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("img", { name: "Updated silk dress" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Black trousers" })).not.toBeInTheDocument();
  });

  it("does not add an Undo step when a selected item is tapped repeatedly", async () => {
    const user = userEvent.setup();
    render(<DressingRoom items={[top]} />);

    await user.click(selectButton("Blue top"));
    await user.click(selectButton("Blue top"));
    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.queryByRole("img", { name: "Blue top" })).not.toBeInTheDocument();
  });
});

describe("App repository isolation", () => {
  it("never lets a stale repository load overwrite the current repository", async () => {
    const user = userEvent.setup();
    const requestA = deferred();
    const requestB = deferred();
    const repositoryA = repository(vi.fn(() => requestA.promise));
    const repositoryB = repository(vi.fn(() => requestB.promise));
    const view = render(<App repository={repositoryA} />);

    view.rerender(<App repository={repositoryB} />);
    await act(async () => requestB.resolve([repositoryBItem]));
    await screen.findByRole("button", { name: "View Repository B jacket" });
    await user.click(screen.getByRole("button", { name: "Dress" }));
    expect(selectButton("Repository B jacket")).toBeInTheDocument();

    await act(async () => requestA.resolve([top]));

    expect(screen.queryByRole("button", { name: "Select Blue top" })).not.toBeInTheDocument();
    expect(selectButton("Repository B jacket")).toBeInTheDocument();
  });

  it("deduplicates the StrictMode initial active-item load", async () => {
    const listItems = vi.fn().mockResolvedValue([top]);
    const currentRepository = repository(listItems);

    render(
      <StrictMode>
        <App repository={currentRepository} />
      </StrictMode>,
    );

    expect(await screen.findByRole("button", { name: "View Blue top" })).toBeInTheDocument();
    expect(listItems).toHaveBeenCalledTimes(1);
  });
});

describe("inactive wardrobe cleanup", () => {
  it("deactivates the editor and releases body scrolling when Dress becomes active", async () => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "clip";
    const user = userEvent.setup();
    const currentRepository = repository(vi.fn().mockResolvedValue([top]));

    try {
      render(<App repository={currentRepository} />);
      await user.click(await screen.findByRole("button", { name: "View Blue top" }));
      expect(screen.getByRole("dialog", { name: "Edit Blue top" })).toBeInTheDocument();
      expect(document.body.style.overflow).toBe("hidden");

      await user.click(screen.getByRole("button", { name: "Dress" }));

      expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
      expect(document.body.style.overflow).toBe("clip");
      expect(screen.getByLabelText("Dressing room")).toBeInTheDocument();
    } finally {
      document.body.style.overflow = previousOverflow;
    }
  });

  it("closes an open WardrobeView editor when active becomes false", async () => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "clip";
    const user = userEvent.setup();
    const currentRepository = repository(vi.fn().mockResolvedValue([top]));

    try {
      const view = render(<WardrobeView repository={currentRepository} active />);
      await user.click(await screen.findByRole("button", { name: "View Blue top" }));
      view.rerender(<WardrobeView repository={currentRepository} active={false} />);

      await waitFor(() => {
        expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
      });
      expect(document.body.style.overflow).toBe("clip");
    } finally {
      document.body.style.overflow = previousOverflow;
    }
  });
});
