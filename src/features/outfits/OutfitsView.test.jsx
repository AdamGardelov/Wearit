import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyAdvancedFilter } from "../../domain/filters.js";
import { SaveOutfitDialog } from "./SaveOutfitDialog.jsx";
import { OutfitsView } from "./OutfitsView.jsx";

afterEach(cleanup);

const top = { id: "top-1", name: "Blue top", slot: "top", status: "active", layer_order: 20, cutoutUrl: "/top.png" };
const bottom = { id: "bottom-1", name: "Black trousers", slot: "bottom", status: "active", layer_order: 30, cutoutUrl: "/bottom.png" };
const shoes = { id: "shoes-1", name: "White shoes", slot: "shoes", status: "active", layer_order: 10, cutoutUrl: "/shoes.png" };
const office = { id: "outfit-1", name: "Office day", items: [top, bottom], thumbnailUrl: "/office.webp", needs_attention: false };

const summer = { id: "s-summer", kind: "season", seasonKey: "summer", name: "Summer", locked: true };
const winter = { id: "s-winter", kind: "season", seasonKey: "winter", name: "Winter", locked: true };
const rainy = { id: "t-rainy", kind: "theme", seasonKey: null, name: "Rainy day", locked: false };
const labels = [summer, winter, rainy];
const topSummerWinter = { ...top, labelIds: ["s-summer", "s-winter"] };
const bottomSummer = { ...bottom, labelIds: ["s-summer"] };
const shoesSummer = { ...shoes, labelIds: ["s-summer"] };

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

    expect(await screen.findByText("Välj minst två plagg.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Spara outfit" })).toBeDisabled();
    expect(screen.getByLabelText("Outfit-namn")).toHaveFocus();
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

    expect(await screen.findByText("Den här kombinationen är redan sparad som Office day.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Outfit-namn"));
    await user.type(screen.getByLabelText("Outfit-namn"), "Office renamed");
    await user.click(screen.getByRole("button", { name: "Uppdatera outfit" }));

    await waitFor(() => expect(repository.saveOutfit).toHaveBeenCalledWith({
      id: "outfit-1",
      name: "Office renamed",
      items: [bottom, top],
      thumbnailBlob: thumbnail,
      labelIds: [],
    }));
    expect(renderThumbnail).toHaveBeenCalledWith([bottom, top], "/mannequin-photoreal.png");
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

    await screen.findByRole("button", { name: "Spara som ny variant" });
    await user.click(screen.getByRole("button", { name: "Spara som ny variant" }));

    await waitFor(() => expect(repository.saveOutfit).toHaveBeenCalledWith({
      name: "Office day",
      items: [top, shoes],
      thumbnailBlob: thumbnail,
      labelIds: [],
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

  it("suggests the intersection of item labels for a new outfit", async () => {
    const user = userEvent.setup();
    const repository = dialogRepository();
    render(
      <SaveOutfitDialog
        items={[topSummerWinter, bottomSummer]}
        repository={repository}
        renderThumbnail={vi.fn().mockResolvedValue(new Blob())}
        labels={labels}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Outfit-namn"), "Sommar");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Sommar" })).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Vinter" })).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Spara outfit" }));
    await waitFor(() => expect(repository.saveOutfit)
      .toHaveBeenCalledWith(expect.objectContaining({ labelIds: ["s-summer"] })));
  });

  it("preserves the exact outfit's saved labels on update", async () => {
    const user = userEvent.setup();
    const repository = dialogRepository([{ ...office, labelIds: ["s-winter"] }]);
    render(
      <SaveOutfitDialog
        items={[topSummerWinter, bottomSummer]}
        repository={repository}
        renderThumbnail={vi.fn().mockResolvedValue(new Blob())}
        labels={labels}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await screen.findByText("Den här kombinationen är redan sparad som Office day.");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Vinter" })).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Sommar" })).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Uppdatera outfit" }));
    await waitFor(() => expect(repository.saveOutfit)
      .toHaveBeenCalledWith(expect.objectContaining({ id: "outfit-1", labelIds: ["s-winter"] })));
  });

  it("uses a fresh intersection for a variation and no source ID", async () => {
    const user = userEvent.setup();
    const repository = dialogRepository([]);
    render(
      <SaveOutfitDialog
        items={[topSummerWinter, shoesSummer]}
        sourceOutfit={{ ...office, labelIds: ["t-rainy"] }}
        repository={repository}
        renderThumbnail={vi.fn().mockResolvedValue(new Blob())}
        labels={labels}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Spara som ny variant" }));
    await waitFor(() => expect(repository.saveOutfit).toHaveBeenCalled());
    const call = repository.saveOutfit.mock.calls.at(-1)[0];
    expect(call.labelIds).toEqual(["s-summer"]);
    expect(call.id).toBeUndefined();
  });

  it("sends edited label suggestions unchanged", async () => {
    const user = userEvent.setup();
    const repository = dialogRepository();
    render(
      <SaveOutfitDialog
        items={[topSummerWinter, bottomSummer]}
        repository={repository}
        renderThumbnail={vi.fn().mockResolvedValue(new Blob())}
        labels={labels}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Outfit-namn"), "Sommar");
    await user.click(await screen.findByRole("checkbox", { name: "Vinter" }));
    await user.click(screen.getByRole("button", { name: "Spara outfit" }));

    await waitFor(() => expect(repository.saveOutfit).toHaveBeenCalled());
    const call = repository.saveOutfit.mock.calls.at(-1)[0];
    expect([...call.labelIds].sort()).toEqual(["s-summer", "s-winter"]);
  });

  it("blocks saving when labels could not be loaded", async () => {
    const user = userEvent.setup();
    const repository = dialogRepository();
    render(
      <SaveOutfitDialog
        items={[top, bottom]}
        repository={repository}
        renderThumbnail={vi.fn()}
        labels={[]}
        labelsError="Etiketter nere."
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Outfit-namn"), "X");
    await waitFor(() => expect(screen.getByRole("button", { name: "Spara outfit" })).toBeDisabled());
    expect(screen.getByText("Etiketter nere.")).toBeInTheDocument();
  });
});

const outfitColors = [
  { id: "green", label: "Grön", swatch: "#4a8c3f" },
  { id: "blue", label: "Blå", swatch: "#2f5fb0" },
];

// App owns the shared advanced filter; this wrapper mirrors that ownership for the view.
function OutfitsHarness({ repository, initialFilter = emptyAdvancedFilter() }) {
  const [advancedFilter, setAdvancedFilter] = useState(initialFilter);
  return (
    <OutfitsView
      active
      repository={repository}
      onLoad={vi.fn()}
      colors={outfitColors}
      labels={labels}
      advancedFilter={advancedFilter}
      onAdvancedFilterChange={setAdvancedFilter}
    />
  );
}

describe("OutfitsView", () => {
  it("loads a saved outfit onto the mannequin", async () => {
    const user = userEvent.setup();
    const onLoad = vi.fn();
    const repository = { listOutfits: vi.fn().mockResolvedValue([office]) };
    render(<OutfitsView active repository={repository} onLoad={onLoad} />);

    expect(await screen.findByRole("img", { name: "Office day" })).toHaveAttribute("src", "/office.webp");
    await user.click(screen.getByRole("button", { name: "Ladda Office day" }));
    expect(onLoad).toHaveBeenCalledWith(office.items, office);
  });

  it("identifies an archived garment and its missing slot", async () => {
    const archivedBottom = { ...bottom, status: "archived", name: "Old trousers", saved_slot: "bottom" };
    const attention = { ...office, id: "attention", name: "Needs a fix", items: [top, archivedBottom], needs_attention: true };
    const repository = { listOutfits: vi.fn().mockResolvedValue([attention]) };
    render(<OutfitsView active repository={repository} onLoad={vi.fn()} />);

    expect(await screen.findByText("Arkiverat plagg: Old trousers")).toBeInTheDocument();
    expect(screen.getByText("Saknar underdel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ladda Needs a fix" })).toBeDisabled();
  });

  it("does not fetch while its application section is inactive", () => {
    const repository = { listOutfits: vi.fn().mockResolvedValue([]) };
    render(<OutfitsView active={false} repository={repository} onLoad={vi.fn()} />);
    expect(repository.listOutfits).not.toHaveBeenCalled();
  });

  it("shows labeled and unlabeled outfits under All and filters by their saved labels", async () => {
    const user = userEvent.setup();
    const summerLook = { ...office, id: "o-summer", name: "Summer look", thumbnailUrl: "/su.webp", labelIds: ["s-summer"] };
    const plainLook = { ...office, id: "o-plain", name: "Plain look", thumbnailUrl: "/pl.webp", labelIds: [] };
    const repository = { listOutfits: vi.fn().mockResolvedValue([summerLook, plainLook]) };
    render(<OutfitsHarness repository={repository} />);

    await screen.findByRole("img", { name: "Summer look" });
    expect(screen.getByRole("img", { name: "Plain look" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.click(screen.getByRole("checkbox", { name: "Sommar" }));

    expect(screen.getByRole("img", { name: "Summer look" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Plain look" })).not.toBeInTheDocument();
  });

  it("scopes the badge, chips, section, and matching to Season and Theme", async () => {
    const user = userEvent.setup();
    const rainLook = { ...office, id: "o-sr", name: "Rain look", thumbnailUrl: "/sr.webp", labelIds: ["s-summer", "t-rainy"] };
    const sunnyLook = { ...office, id: "o-s", name: "Sunny look", thumbnailUrl: "/s.webp", labelIds: ["s-summer"] };
    const repository = { listOutfits: vi.fn().mockResolvedValue([rainLook, sunnyLook]) };
    const initialFilter = { selectedColorIds: ["green"], selectedSeasonIds: ["s-summer"], selectedThemeIds: ["t-rainy"] };
    render(<OutfitsHarness repository={repository} initialFilter={initialFilter} />);

    await screen.findByRole("img", { name: "Rain look" });

    // The badge counts Season + Theme only (2), not the retained Colour (3).
    expect(screen.getByRole("button", { name: "Filter" })).toHaveTextContent("2");
    // No Colour chip is shown even though green stays in the shared state.
    expect(screen.queryByRole("button", { name: "Ta bort Grön" })).not.toBeInTheDocument();
    // Summer AND Rainy day matches only the rain look.
    expect(screen.queryByRole("img", { name: "Sunny look" })).not.toBeInTheDocument();

    // The panel omits the Colour section entirely.
    await user.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.queryByText("Färg")).not.toBeInTheDocument();

    // Clear all clears Season/Theme but keeps the retained Colour, so all outfits return.
    await user.click(screen.getByRole("button", { name: "Rensa alla" }));
    expect(screen.getByRole("img", { name: "Rain look" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Sunny look" })).toBeInTheDocument();
  });

  it("ignores a Colour-only selection and shows no advanced summary", async () => {
    const summerLook = { ...office, id: "o-summer", name: "Summer look", thumbnailUrl: "/su.webp", labelIds: ["s-summer"] };
    const plainLook = { ...office, id: "o-plain", name: "Plain look", thumbnailUrl: "/pl.webp", labelIds: [] };
    const repository = { listOutfits: vi.fn().mockResolvedValue([summerLook, plainLook]) };
    render(<OutfitsHarness repository={repository} initialFilter={{ selectedColorIds: ["green"], selectedSeasonIds: [], selectedThemeIds: [] }} />);

    await screen.findByRole("img", { name: "Summer look" });
    // Colour is not an outfit group, so every outfit stays visible...
    expect(screen.getByRole("img", { name: "Plain look" })).toBeInTheDocument();
    // ...and no "X av Y" summary appears because no applicable group is active.
    expect(screen.queryByText("2 av 2")).not.toBeInTheDocument();
  });

  it("deletes an outfit after confirmation and removes it from the grid", async () => {
    const user = userEvent.setup();
    const casual = { ...office, id: "outfit-2", name: "Casual day", thumbnailUrl: "/casual.webp" };
    const deleteOutfit = vi.fn().mockResolvedValue({ id: "outfit-1" });
    const repository = { listOutfits: vi.fn().mockResolvedValue([office, casual]), deleteOutfit };
    render(<OutfitsView active repository={repository} onLoad={vi.fn()} />);
    await screen.findByRole("img", { name: "Office day" });

    await user.click(screen.getByRole("button", { name: "Ta bort Office day" }));
    await user.click(screen.getByRole("button", { name: "Bekräfta borttagning av Office day" }));

    await waitFor(() => expect(deleteOutfit).toHaveBeenCalledWith("outfit-1"));
    await waitFor(() => expect(screen.queryByRole("img", { name: "Office day" })).not.toBeInTheDocument());
    expect(screen.getByRole("img", { name: "Casual day" })).toBeInTheDocument();
  });

  it("cancels an outfit deletion without calling the repository", async () => {
    const user = userEvent.setup();
    const deleteOutfit = vi.fn();
    const repository = { listOutfits: vi.fn().mockResolvedValue([office]), deleteOutfit };
    render(<OutfitsView active repository={repository} onLoad={vi.fn()} />);
    await screen.findByRole("img", { name: "Office day" });

    await user.click(screen.getByRole("button", { name: "Ta bort Office day" }));
    await user.click(screen.getByRole("button", { name: "Avbryt" }));

    expect(deleteOutfit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Ladda Office day" })).toBeInTheDocument();
  });

  it("keeps the outfit and reports an error when deletion fails", async () => {
    const user = userEvent.setup();
    const deleteOutfit = vi.fn().mockRejectedValue(new Error("Kunde inte ta bort."));
    const repository = { listOutfits: vi.fn().mockResolvedValue([office]), deleteOutfit };
    render(<OutfitsView active repository={repository} onLoad={vi.fn()} />);
    await screen.findByRole("img", { name: "Office day" });

    await user.click(screen.getByRole("button", { name: "Ta bort Office day" }));
    await user.click(screen.getByRole("button", { name: "Bekräfta borttagning av Office day" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Kunde inte ta bort.");
    expect(screen.getByRole("img", { name: "Office day" })).toBeInTheDocument();
  });

  it("offers no delete control when the repository cannot delete outfits", async () => {
    const repository = { listOutfits: vi.fn().mockResolvedValue([office]) };
    render(<OutfitsView active repository={repository} onLoad={vi.fn()} />);
    await screen.findByRole("img", { name: "Office day" });

    expect(screen.queryByRole("button", { name: "Ta bort Office day" })).not.toBeInTheDocument();
  });
});
