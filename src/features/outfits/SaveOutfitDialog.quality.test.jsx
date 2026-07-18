import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SaveOutfitDialog } from "./SaveOutfitDialog.jsx";

afterEach(cleanup);

const items = [
  { id: "top-1", slot: "top" },
  { id: "bottom-1", slot: "bottom" },
];

it("keeps saving disabled when duplicate detection could not be completed", async () => {
  const user = userEvent.setup();
  const renderThumbnail = vi.fn();
  const repository = {
    listOutfits: vi.fn().mockRejectedValue(new Error("duplicate lookup unavailable")),
    saveOutfit: vi.fn(),
  };
  render(
    <SaveOutfitDialog
      items={items}
      repository={repository}
      renderThumbnail={renderThumbnail}
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("Outfit-namn"), "Office day");
  expect(await screen.findByRole("alert")).toHaveTextContent("duplicate lookup unavailable");
  expect(screen.getByRole("button", { name: "Spara outfit" })).toBeDisabled();
  expect(renderThumbnail).not.toHaveBeenCalled();
});

it("reports a save failure separately after duplicate detection succeeds", async () => {
  const user = userEvent.setup();
  const repository = {
    listOutfits: vi.fn().mockResolvedValue([]),
    saveOutfit: vi.fn().mockRejectedValue(new Error("save unavailable")),
  };
  render(
    <SaveOutfitDialog
      items={items}
      repository={repository}
      renderThumbnail={vi.fn().mockResolvedValue(new Blob())}
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("Outfit-namn"), "Office day");
  await user.click(await screen.findByRole("button", { name: "Spara outfit" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("save unavailable");
  expect(repository.saveOutfit).toHaveBeenCalledTimes(1);
});
