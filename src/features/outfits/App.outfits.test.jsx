import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../../App.jsx";

afterEach(cleanup);

const top = { id: "top-1", name: "Blue top", category: "top", slot: "top", status: "active", cutoutUrl: "/top.png", anchor_x: 0.5, anchor_y: 0.3, scale: 0.5, rotation_degrees: 0, layer_order: 20 };
const bottom = { id: "bottom-1", name: "Black trousers", category: "bottom", slot: "bottom", status: "active", cutoutUrl: "/bottom.png", anchor_x: 0.5, anchor_y: 0.6, scale: 0.5, rotation_degrees: 0, layer_order: 30 };
const outfit = { id: "outfit-1", name: "Office day", items: [top, bottom], thumbnailUrl: "/office.webp", needs_attention: false };

it("loads a saved outfit from Outfits into the persistent dressing-room reducer", async () => {
  const user = userEvent.setup();
  const repository = {
    listItems: vi.fn().mockResolvedValue([top, bottom]),
    updateItem: vi.fn(),
    archiveItem: vi.fn(),
    restoreItem: vi.fn(),
    createSignedAssetUrls: vi.fn(),
    listOutfits: vi.fn().mockResolvedValue([outfit]),
    saveOutfit: vi.fn(),
  };
  render(<App repository={repository} />);

  await screen.findByRole("button", { name: "Visa Blue top" });
  await user.click(screen.getByRole("button", { name: "Outfits" }));
  await user.click(await screen.findByRole("button", { name: "Ladda Office day" }));

  expect(screen.getByRole("button", { name: "Dress" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("img", { name: "Blue top" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Black trousers" })).toBeInTheDocument();
});
