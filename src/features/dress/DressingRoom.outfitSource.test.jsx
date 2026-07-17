import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DressingRoom } from "./DressingRoom.jsx";

afterEach(cleanup);

const shoes = { id: "shoes", name: "Shoes", slot: "shoes", layer_order: 10, cutoutUrl: "/shoes.png" };
const top = { id: "top", name: "Top", slot: "top", layer_order: 20, cutoutUrl: "/top.png" };
const bottom = { id: "bottom", name: "Bottom", slot: "bottom", layer_order: 30, cutoutUrl: "/bottom.png" };
const jacket = { id: "jacket", name: "Jacket", slot: "outerwear", layer_order: 40, cutoutUrl: "/jacket.png" };
const items = [shoes, top, bottom, jacket];

it("detaches loaded-outfit provenance only when Undo crosses the load boundary", async () => {
  const user = userEvent.setup();
  const onLoadedOutfitChange = vi.fn();
  const view = render(
    <DressingRoom items={items} onLoadedOutfitChange={onLoadedOutfitChange} />,
  );
  await user.click(screen.getByRole("button", { name: "Select Shoes" }));

  view.rerender(
    <DressingRoom
      items={items}
      loadRequest={{ key: 1, items: [top, bottom], previousSourceOutfit: null, sourceOutfit: { id: "outfit-a" } }}
      onLoadedOutfitChange={onLoadedOutfitChange}
    />,
  );
  expect(await screen.findByRole("img", { name: "Top" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Select Jacket" }));

  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(onLoadedOutfitChange).not.toHaveBeenCalled();
  expect(screen.getByRole("img", { name: "Top" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(onLoadedOutfitChange).toHaveBeenCalledWith(null);
  expect(screen.getByRole("img", { name: "Shoes" })).toBeInTheDocument();
});
