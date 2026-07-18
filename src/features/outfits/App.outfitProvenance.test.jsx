import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../../App.jsx";

afterEach(cleanup);

function garment(id, name, slot, layerOrder) {
  return {
    id,
    name,
    category: slot === "outerwear" ? "jacket" : slot,
    slot,
    status: "active",
    cutoutUrl: `/${id}.png`,
    anchor_x: 0.5,
    anchor_y: 0.5,
    scale: 0.5,
    rotation_degrees: 0,
    layer_order: layerOrder,
  };
}

const top = garment("top-a", "A top", "top", 20);
const bottom = garment("bottom-a", "A bottom", "bottom", 30);
const dress = garment("dress-b", "B dress", "dress", 25);
const jacket = garment("jacket-b", "B jacket", "outerwear", 40);
const shoes = garment("shoes", "Shoes", "shoes", 10);
const outfitA = { id: "outfit-a", name: "Outfit A", items: [top, bottom], thumbnailUrl: "/a.webp", needs_attention: false };
const outfitB = { id: "outfit-b", name: "Outfit B", items: [dress, jacket], thumbnailUrl: "/b.webp", needs_attention: false };

it("restores outfit A provenance when Undo crosses the later outfit B load", async () => {
  const user = userEvent.setup();
  const repository = {
    listItems: vi.fn().mockResolvedValue([top, bottom, dress, jacket, shoes]),
    updateItem: vi.fn(),
    archiveItem: vi.fn(),
    restoreItem: vi.fn(),
    createSignedAssetUrls: vi.fn(),
    listOutfits: vi.fn().mockResolvedValue([outfitA, outfitB]),
    saveOutfit: vi.fn(),
  };
  render(<App repository={repository} />);

  await screen.findByRole("button", { name: "Visa A top" });
  await user.click(screen.getByRole("button", { name: "Outfits" }));
  await user.click(await screen.findByRole("button", { name: "Ladda Outfit A" }));
  await user.click(screen.getByRole("button", { name: "Outfits" }));
  await user.click(await screen.findByRole("button", { name: "Ladda Outfit B" }));

  await user.click(screen.getByRole("button", { name: "Ångra" }));
  expect(screen.getByRole("img", { name: "A top" })).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: "B dress" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Välj Shoes" }));
  await user.click(screen.getByRole("button", { name: "Spara outfit" }));

  expect(await screen.findByLabelText("Outfit-namn")).toHaveValue("Outfit A");
  expect(screen.getByRole("button", { name: "Uppdatera outfit" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Spara som ny variant" })).toBeEnabled();
});
