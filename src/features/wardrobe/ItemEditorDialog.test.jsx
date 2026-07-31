import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CATEGORIES } from "../../domain/slots.js";
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
    categories: CATEGORIES,
    ...overrides,
  };
  render(<ItemEditorDialog {...props} />);
  return props;
}

describe("ItemEditorDialog gallery", () => {
  it("offers the expanded wardrobe categories", () => {
    renderDialog();

    const category = screen.getByRole("combobox", { name: "Kategori" });
    for (const label of ["Hattar", "Bälten", "Väskor", "Halsdukar"]) {
      expect(within(category).getByRole("option", { name: label })).toBeInTheDocument();
    }
  });

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

describe("ItemEditorDialog category creation", () => {
  it("opens an inline form with the supported Swedish slot labels", async () => {
    const user = userEvent.setup();
    renderDialog({ onCreateCategory: vi.fn() });

    await user.selectOptions(screen.getByRole("combobox", { name: "Kategori" }), "__new_category__");

    expect(screen.getByRole("option", { name: "+ Lägg till kategori…" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Namn på kategori" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Namn på kategori" })).toBeRequired();
    expect(screen.getByRole("textbox", { name: "Namn på kategori" })).toHaveAttribute("maxlength", "80");
    expect(screen.getByRole("combobox", { name: "Typ av plagg" })).toBeRequired();
    expect(within(screen.getByRole("combobox", { name: "Typ av plagg" })).getAllByRole("option")
      .map((option) => option.textContent)).toEqual([
        "Överdelar",
        "Underdelar",
        "Klänningar",
        "Ytterplagg",
        "Skor",
        "Accessoarer",
      ]);
  });

  it("rejects a blank category name without calling the repository", async () => {
    const user = userEvent.setup();
    const onCreateCategory = vi.fn();
    renderDialog({ onCreateCategory });
    await user.selectOptions(screen.getByRole("combobox", { name: "Kategori" }), "__new_category__");

    await user.type(screen.getByRole("textbox", { name: "Namn på kategori" }), "   ");
    await user.click(screen.getByRole("button", { name: "Lägg till" }));

    expect(onCreateCategory).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Ange ett namn på kategorin.");
  });

  it("keeps the category draft and exposes duplicate errors accessibly", async () => {
    const user = userEvent.setup();
    const onCreateCategory = vi.fn().mockRejectedValue({ code: "23505" });
    renderDialog({ onCreateCategory });
    await user.selectOptions(screen.getByRole("combobox", { name: "Kategori" }), "__new_category__");
    await user.type(screen.getByRole("textbox", { name: "Namn på kategori" }), "Kavajer");

    await user.click(screen.getByRole("button", { name: "Lägg till" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Det finns redan en kategori med det namnet.");
    expect(screen.getByRole("textbox", { name: "Namn på kategori" })).toHaveValue("Kavajer");
  });

  it("cancels creation and restores the previous category selection", async () => {
    const user = userEvent.setup();
    renderDialog({ onCreateCategory: vi.fn() });
    const categorySelect = screen.getByRole("combobox", { name: "Kategori" });
    expect(categorySelect).toHaveValue("top");
    await user.selectOptions(categorySelect, "__new_category__");

    await user.click(within(screen.getByRole("group", { name: "Ny kategori" }))
      .getByRole("button", { name: "Avbryt" }));

    expect(categorySelect).toHaveValue("top");
    expect(screen.queryByRole("textbox", { name: "Namn på kategori" })).not.toBeInTheDocument();
  });

  it("creates, selects, and saves a custom category without losing other draft edits", async () => {
    const user = userEvent.setup();
    const onCreateCategory = vi.fn().mockResolvedValue({
      id: "category-1",
      label: "Kavajer",
      slot: "outerwear",
      builtIn: false,
    });
    const onSave = vi.fn();
    renderDialog({ onCreateCategory, onSave });

    await user.clear(screen.getByRole("textbox", { name: "Namn" }));
    await user.type(screen.getByRole("textbox", { name: "Namn" }), "Min kavaj");
    await user.type(screen.getByRole("textbox", { name: "Märke" }), "Acme");
    await user.selectOptions(screen.getByRole("combobox", { name: "Kategori" }), "__new_category__");
    await user.type(screen.getByRole("textbox", { name: "Namn på kategori" }), "  Kavajer  ");
    await user.selectOptions(screen.getByRole("combobox", { name: "Typ av plagg" }), "outerwear");

    await user.click(screen.getByRole("button", { name: "Lägg till" }));

    expect(onCreateCategory).toHaveBeenCalledWith({ name: "Kavajer", slot: "outerwear" });
    expect(screen.getByRole("combobox", { name: "Kategori" })).toHaveValue("category-1");
    expect(screen.queryByRole("textbox", { name: "Namn på kategori" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Namn" })).toHaveValue("Min kavaj");
    expect(screen.getByRole("textbox", { name: "Märke" })).toHaveValue("Acme");

    await user.click(screen.getByRole("button", { name: "Spara" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: "Min kavaj",
      brand: "Acme",
      category: "category-1",
      slot: "outerwear",
    }));
  });

  it("preserves the existing slot when selecting a built-in category", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderDialog({ onSave });

    await user.selectOptions(screen.getByRole("combobox", { name: "Kategori" }), "jacket");
    await user.click(screen.getByRole("button", { name: "Spara" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ category: "jacket", slot: "top" }));
  });

  it("adds the category with Enter instead of submitting the item form", async () => {
    const user = userEvent.setup();
    const onCreateCategory = vi.fn().mockResolvedValue({
      id: "category-1",
      label: "Kavajer",
      slot: "outerwear",
      builtIn: false,
    });
    const onSave = vi.fn();
    renderDialog({ onCreateCategory, onSave });
    await user.selectOptions(screen.getByRole("combobox", { name: "Kategori" }), "__new_category__");
    await user.selectOptions(screen.getByRole("combobox", { name: "Typ av plagg" }), "outerwear");

    await user.type(screen.getByRole("textbox", { name: "Namn på kategori" }), "Kavajer{Enter}");

    expect(onCreateCategory).toHaveBeenCalledWith({ name: "Kavajer", slot: "outerwear" });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("disables save while an existing custom category cannot be resolved", () => {
    renderDialog({
      item: { ...multiImageItem, category: "category-1", slot: "outerwear" },
      categories: [],
      categoriesLoading: true,
    });

    expect(screen.getByRole("button", { name: "Spara" })).toBeDisabled();
  });

  it("keeps save available for a built-in category when category loading fails", () => {
    renderDialog({
      categories: CATEGORIES,
      categoriesError: "Kunde inte ladda kategorier.",
    });

    expect(screen.getByRole("button", { name: "Spara" })).toBeEnabled();
  });
});
