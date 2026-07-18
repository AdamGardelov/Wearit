import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemEditorDialog } from "./ItemEditorDialog.jsx";

afterEach(cleanup);

const multiImageItem = {
  id: "item-1",
  name: "Disco tee",
  category: "top",
  slot: "top",
  brand: "",
  size: "",
  notes: "",
  colors: [],
  tags: [],
  cutoutUrl: "https://assets.test/layer.png",
  primaryImageUrl: "https://assets.test/front.webp",
  images: [
    { id: "front", view: "front", sortOrder: 0, isPrimary: true, url: "https://assets.test/front.webp" },
    { id: "back", view: "back", sortOrder: 1, isPrimary: false, url: "https://assets.test/back.webp" },
  ],
  anchor_x: 0.5,
  anchor_y: 0.34,
  scale: 0.6,
  rotation_degrees: 0,
  layer_order: 30,
  status: "active",
};

function renderDialog(overrides = {}) {
  const props = {
    item: multiImageItem,
    onClose: vi.fn(),
    onSave: vi.fn(),
    onArchive: vi.fn(),
    onMarkWorn: vi.fn(),
    ...overrides,
  };
  render(<ItemEditorDialog {...props} />);
  return props;
}

describe("ItemEditorDialog gallery", () => {
  it("shows the primary front image with front/back thumbnails and switches on selection", async () => {
    const user = userEvent.setup();
    renderDialog();

    const active = screen.getByRole("img", { name: "Disco tee" });
    expect(active).toHaveAttribute("src", "https://assets.test/front.webp");
    expect(screen.getByRole("button", { name: "Visa Frambild 1" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Visa Bakbild 2" }));

    expect(screen.getByRole("img", { name: "Disco tee" }))
      .toHaveAttribute("src", "https://assets.test/back.webp");
  });

  it("opens the lightbox and navigates and closes by keyboard", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Zooma Disco tee, Fram" }));

    const lightbox = screen.getByRole("dialog", { name: "Disco tee bildvisare" });
    expect(within(lightbox).getByText("1 / 2")).toBeInTheDocument();
    expect(within(lightbox).getByRole("img")).toHaveAttribute("src", "https://assets.test/front.webp");

    await user.keyboard("{ArrowRight}");
    expect(within(lightbox).getByRole("img")).toHaveAttribute("src", "https://assets.test/back.webp");
    expect(within(lightbox).getByText("2 / 2")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Disco tee bildvisare" })).not.toBeInTheDocument();
  });

  it("zooms in and out with the toolbar controls", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Zooma Disco tee, Fram" }));
    const lightbox = screen.getByRole("dialog", { name: "Disco tee bildvisare" });
    const image = within(lightbox).getByRole("img");

    expect(within(lightbox).getByRole("button", { name: "Återställ zoom" })).toBeDisabled();

    await user.click(within(lightbox).getByRole("button", { name: "Zooma in" }));
    expect(image.style.transform).toContain("scale(1.5)");
    expect(within(lightbox).getByRole("button", { name: "Återställ zoom" })).toBeEnabled();

    await user.click(within(lightbox).getByRole("button", { name: "Återställ zoom" }));
    expect(image.style.transform).toContain("scale(1)");
  });

  async function openZoomableStage(user) {
    await user.click(screen.getByRole("button", { name: "Zooma Disco tee, Fram" }));
    const lightbox = screen.getByRole("dialog", { name: "Disco tee bildvisare" });
    const stage = lightbox.querySelector(".lightbox-stage");
    const image = within(lightbox).getByRole("img");
    Object.defineProperty(stage, "clientWidth", { value: 1000, configurable: true });
    Object.defineProperty(stage, "clientHeight", { value: 1000, configurable: true });
    return { lightbox, stage, image };
  }

  it("pans a zoomed image by dragging and stays zoomed", async () => {
    const user = userEvent.setup();
    renderDialog();
    const { lightbox, stage, image } = await openZoomableStage(user);

    await user.click(within(lightbox).getByRole("button", { name: "Zooma in" }));
    await user.click(within(lightbox).getByRole("button", { name: "Zooma in" }));
    expect(image.style.transform).toContain("scale(2)");

    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 500, clientY: 500, pointerType: "mouse" });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 400, clientY: 460 });
    expect(image.style.transform).toContain("translate(-100px, -40px)");

    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 400, clientY: 460, pointerType: "mouse" });
    // A drag must never toggle zoom off.
    expect(image.style.transform).toContain("scale(2)");
  });

  it("ignores a single stationary click so it cannot fight panning", async () => {
    const user = userEvent.setup();
    renderDialog();
    const { stage, image } = await openZoomableStage(user);

    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 500, clientY: 500, pointerType: "mouse" });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 500, clientY: 500, pointerType: "mouse" });

    expect(image.style.transform).toContain("scale(1)");
  });

  it("toggles zoom on a double click", async () => {
    const user = userEvent.setup();
    renderDialog();
    const { stage, image } = await openZoomableStage(user);

    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 500, clientY: 500, pointerType: "mouse" });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 500, clientY: 500, pointerType: "mouse" });
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 500, clientY: 500, pointerType: "mouse" });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 500, clientY: 500, pointerType: "mouse" });

    expect(image.style.transform).toContain("scale(2.5)");
  });

  it("falls back to the cutout as a single zoomable image for legacy items", async () => {
    const user = userEvent.setup();
    const legacyItem = { ...multiImageItem, images: [], primaryImageUrl: undefined };
    renderDialog({ item: legacyItem });

    expect(screen.queryByRole("button", { name: /Visa .*bild/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Zooma Disco tee" }));

    const lightbox = screen.getByRole("dialog", { name: "Disco tee bildvisare" });
    expect(within(lightbox).getByRole("img")).toHaveAttribute("src", "https://assets.test/layer.png");
  });
});
