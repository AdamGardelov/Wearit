import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.jsx";
import { DressingRoom } from "./DressingRoom.jsx";

afterEach(cleanup);

const top = {
  id: "top-1",
  name: "Blue top",
  category: "top",
  slot: "top",
  cutoutUrl: "/top.png",
  anchor_x: 0.5,
  anchor_y: 0.34,
  scale: 0.52,
  rotation_degrees: -2,
  layer_order: 20,
};
const bottom = {
  id: "bottom-1",
  name: "Black trousers",
  category: "bottom",
  slot: "bottom",
  cutoutUrl: "/bottom.png",
  anchor_x: 0.5,
  anchor_y: 0.59,
  scale: 0.6,
  rotation_degrees: 0,
  layer_order: 30,
};
const dress = {
  id: "dress-1",
  name: "Green dress",
  category: "dress",
  slot: "dress",
  cutoutUrl: "/dress.png",
  anchor_x: 0.5,
  anchor_y: 0.48,
  scale: 0.68,
  rotation_degrees: 1,
  layer_order: 25,
};
const jacket = {
  id: "jacket-1",
  name: "Brown jacket",
  category: "jacket",
  slot: "outerwear",
  cutoutUrl: "/jacket.png",
  anchor_x: 0.5,
  anchor_y: 0.35,
  scale: 0.58,
  rotation_degrees: 0,
  layer_order: 40,
};
const shoes = {
  id: "shoes-1",
  name: "White shoes",
  category: "shoes",
  slot: "shoes",
  cutoutUrl: "/shoes.png",
  anchor_x: 0.5,
  anchor_y: 0.93,
  scale: 0.45,
  rotation_degrees: 0,
  layer_order: 10,
};
const accessory = {
  id: "accessory-1",
  name: "Red bag",
  category: "accessory",
  slot: "accessory",
  cutoutUrl: "/bag.png",
  anchor_x: 0.7,
  anchor_y: 0.55,
  scale: 0.3,
  rotation_degrees: 4,
  layer_order: 50,
};

const items = [top, bottom, dress, jacket, shoes, accessory];

function itemButton(name) {
  return screen.getByRole("button", { name: `Välj ${name}` });
}

describe("DressingRoom", () => {
  it("composes compatible pieces, applies placement, and restores reducer history", async () => {
    const user = userEvent.setup();
    render(<DressingRoom items={items} />);

    await user.click(itemButton("Blue top"));
    await user.click(itemButton("Black trousers"));

    const topImage = screen.getByRole("img", { name: "Blue top" });
    expect(topImage).toHaveStyle({
      left: "50%",
      top: "34%",
      width: "52%",
      zIndex: "20",
      transform: "translate(-50%, -50%) rotate(-2deg)",
    });
    expect(screen.getByRole("img", { name: "Black trousers" })).toBeInTheDocument();

    await user.click(itemButton("Green dress"));

    expect(screen.queryByRole("img", { name: "Blue top" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Black trousers" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Green dress" })).toBeInTheDocument();

    await user.click(itemButton("Brown jacket"));

    const dressImage = screen.getByRole("img", { name: "Green dress" });
    const jacketImage = screen.getByRole("img", { name: "Brown jacket" });
    expect(dressImage).toBeInTheDocument();
    expect(Number(jacketImage.style.zIndex)).toBeGreaterThan(Number(dressImage.style.zIndex));
    expect(dressImage.compareDocumentPosition(jacketImage) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Ångra" }));
    expect(screen.queryByRole("img", { name: "Brown jacket" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Green dress" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ångra" }));
    expect(screen.getByRole("img", { name: "Blue top" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Black trousers" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Green dress" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rensa" }));
    expect(screen.queryByRole("img", { name: "Blue top" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Black trousers" })).not.toBeInTheDocument();
  });

  it("enables outfit actions at sensible thresholds and emits deterministic selections", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onWear = vi.fn();
    render(<DressingRoom items={items} onSave={onSave} onWear={onWear} />);
    const saveButton = screen.getByRole("button", { name: "Spara outfit" });
    const wearButton = screen.getByRole("button", { name: "Bär outfit" });

    expect(saveButton).toBeDisabled();
    expect(wearButton).toBeDisabled();

    await user.click(itemButton("Black trousers"));
    expect(saveButton).toBeDisabled();
    expect(wearButton).toBeEnabled();
    await user.click(wearButton);
    expect(onWear).toHaveBeenCalledWith([bottom]);

    await user.click(itemButton("Blue top"));
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);
    expect(onSave).toHaveBeenCalledWith([top, bottom]);
  });

  it("filters the tray without changing the current composition", async () => {
    const user = userEvent.setup();
    render(<DressingRoom items={items} />);

    await user.click(itemButton("Blue top"));
    await user.click(itemButton("Black trousers"));
    expect(itemButton("Blue top")).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Klänningar" }));

    expect(itemButton("Green dress")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Välj Blue top" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Blue top" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Black trousers" })).toBeInTheDocument();
  });

  it("hides category chips that have no garments", async () => {
    render(<DressingRoom items={[top]} />);

    expect(screen.getByRole("button", { name: "Alla" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Överdelar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Klänningar" })).not.toBeInTheDocument();
  });
});

describe("App dressing-room integration", () => {
  it("loads once, shares repository updates, and preserves a composition across sections", async () => {
    const user = userEvent.setup();
    const updatedTop = { ...top, name: "Tailored top", cutoutUrl: undefined };
    const repository = {
      listItems: vi.fn().mockResolvedValue([top, bottom]),
      updateItem: vi.fn().mockResolvedValue(updatedTop),
      archiveItem: vi.fn(),
      restoreItem: vi.fn(),
      createSignedAssetUrls: vi.fn(),
    };
    render(<App repository={repository} />);

    await screen.findByRole("button", { name: "Visa Blue top" });
    await user.click(screen.getByRole("button", { name: "Dress" }));
    await user.click(itemButton("Blue top"));
    await user.click(itemButton("Black trousers"));
    await user.click(screen.getByRole("button", { name: "Wardrobe" }));
    await user.click(screen.getByRole("button", { name: "Visa Blue top" }));
    await user.clear(screen.getByLabelText("Namn"));
    await user.type(screen.getByLabelText("Namn"), "Tailored top");
    await user.click(screen.getByRole("button", { name: "Spara" }));
    await user.click(screen.getByRole("button", { name: "Dress" }));

    expect(repository.listItems).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("img", { name: "Tailored top" })).toHaveAttribute("src", top.cutoutUrl);
    expect(screen.getByRole("img", { name: "Black trousers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dress" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Dress" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("navigation", { name: "Primär" })).toBeInTheDocument();
  });

  it("labels placeholder sections without pretending they are persisted", async () => {
    const user = userEvent.setup();
    const repository = {
      listItems: vi.fn().mockResolvedValue([]),
      updateItem: vi.fn(),
      archiveItem: vi.fn(),
      restoreItem: vi.fn(),
      createSignedAssetUrls: vi.fn(),
    };
    render(<App repository={repository} />);

    await waitFor(() => expect(repository.listItems).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Outfits" }));
    expect(screen.getByText("Sparade outfits är inte tillgängliga än.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByText("Historiken är inte tillgänglig än.")).toBeInTheDocument();
  });
});
