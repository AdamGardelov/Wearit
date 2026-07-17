import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveOutfitDialog } from "./SaveOutfitDialog.jsx";
import { OutfitsView } from "./OutfitsView.jsx";

afterEach(cleanup);

const top = { id: "top-1", name: "Blue top", slot: "top", status: "active", layer_order: 20, cutoutUrl: "/top.png" };
const bottom = { id: "bottom-1", name: "Black trousers", slot: "bottom", status: "active", layer_order: 30, cutoutUrl: "/bottom.png" };
const shoes = { id: "shoes-1", name: "White shoes", slot: "shoes", status: "active", layer_order: 10, cutoutUrl: "/shoes.png" };
const office = { id: "outfit-1", name: "Office day", items: [top, bottom], thumbnailUrl: "/office.webp", needs_attention: false };

function dialogRepository(outfits = []) {
  return {
    listOutfits: vi.fn().mockResolvedValue(outfits),
    saveOutfit: vi.fn(async (draft) => ({ id: draft.id ?? "outfit-new", ...draft })),
  };
}

describe("SaveOutfitDialog", () => {
  it("requires at least two items and a non-empty name", async () => {
    const repository = dialogRepository();
    render(
      <SaveOutfitDialog
        items={[top]}
        repository={repository}
        renderThumbnail={vi.fn()}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(await screen.findByText("Choose at least two items.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save outfit" })).toBeDisabled();
    expect(screen.getByLabelText("Outfit name")).toHaveFocus();
  });

  it("shows an exact duplicate and updates that outfit ID with a fresh thumbnail", async () => {
    const user = userEvent.setup();
    const repository = dialogRepository([office]);
    const thumbnail = new Blob(["fresh"], { type: "image/webp" });
    const renderThumbnail = vi.fn().mockResolvedValue(thumbnail);
    render(
      <SaveOutfitDialog
        items={[bottom, top]}
        repository={repository}
        renderThumbnail={renderThumbnail}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(await screen.findByText("This combination is already saved as Office day.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Outfit name"));
    await user.type(screen.getByLabelText("Outfit name"), "Office renamed");
    await user.click(screen.getByRole("button", { name: "Update outfit" }));

    await waitFor(() => expect(repository.saveOutfit).toHaveBeenCalledWith({
      id: "outfit-1",
      name: "Office renamed",
      items: [bottom, top],
      thumbnailBlob: thumbnail,
    }));
    expect(renderThumbnail).toHaveBeenCalledWith([bottom, top], "/mannequin.svg");
  });

  it("saves a changed loaded outfit as a new variation without reusing its ID", async () => {
    const user = userEvent.setup();
    const repository = dialogRepository([office]);
    const thumbnail = new Blob(["variation"], { type: "image/webp" });
    const renderThumbnail = vi.fn().mockResolvedValue(thumbnail);
    render(
      <SaveOutfitDialog
        items={[top, shoes]}
        sourceOutfit={office}
        repository={repository}
        renderThumbnail={renderThumbnail}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await screen.findByRole("button", { name: "Save as new variation" });
    await user.click(screen.getByRole("button", { name: "Save as new variation" }));

    await waitFor(() => expect(repository.saveOutfit).toHaveBeenCalledWith({
      name: "Office day",
      items: [top, shoes],
      thumbnailBlob: thumbnail,
    }));
    expect(renderThumbnail).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape while idle", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SaveOutfitDialog
        items={[top, bottom]}
        repository={dialogRepository()}
        renderThumbnail={vi.fn()}
        onClose={onClose}
        onSaved={vi.fn()}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("OutfitsView", () => {
  it("loads a saved outfit onto the mannequin", async () => {
    const user = userEvent.setup();
    const onLoad = vi.fn();
    const repository = { listOutfits: vi.fn().mockResolvedValue([office]) };
    render(<OutfitsView active repository={repository} onLoad={onLoad} />);

    expect(await screen.findByRole("img", { name: "Office day" })).toHaveAttribute("src", "/office.webp");
    await user.click(screen.getByRole("button", { name: "Load Office day" }));
    expect(onLoad).toHaveBeenCalledWith(office.items, office);
  });

  it("identifies an archived garment and its missing slot", async () => {
    const archivedBottom = { ...bottom, status: "archived", name: "Old trousers", saved_slot: "bottom" };
    const attention = { ...office, id: "attention", name: "Needs a fix", items: [top, archivedBottom], needs_attention: true };
    const repository = { listOutfits: vi.fn().mockResolvedValue([attention]) };
    render(<OutfitsView active repository={repository} onLoad={vi.fn()} />);

    expect(await screen.findByText("Archived garment: Old trousers")).toBeInTheDocument();
    expect(screen.getByText("Missing bottom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load Needs a fix" })).toBeDisabled();
  });

  it("does not fetch while its application section is inactive", () => {
    const repository = { listOutfits: vi.fn().mockResolvedValue([]) };
    render(<OutfitsView active={false} repository={repository} onLoad={vi.fn()} />);
    expect(repository.listOutfits).not.toHaveBeenCalled();
  });
});
