import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyAdvancedFilter } from "../../domain/filters.js";
import { WeekPlanner } from "./WeekPlanner.jsx";

afterEach(cleanup);

const items = [{ id: "top-1", status: "active" }, { id: "bottom-1", status: "active" }];
const office = { id: "o-1", name: "Office", items, thumbnailUrl: "/o.webp", needs_attention: false };
const brokenOutfit = {
  id: "o-b", name: "Broken", items: [{ id: "x", status: "archived" }], thumbnailUrl: "/b.webp", needs_attention: true,
};

function emptyPlan() {
  return [1, 2, 3, 4, 5].map((weekday) => ({ weekday, outfitId: null, outfit: null }));
}

function planWith(byDay) {
  return [1, 2, 3, 4, 5].map((weekday) => (
    byDay[weekday]
      ? { weekday, outfitId: byDay[weekday].id, outfit: byDay[weekday] }
      : { weekday, outfitId: null, outfit: null }
  ));
}

function plannerRepo(overrides = {}) {
  return {
    listWeeklyPlan: vi.fn().mockResolvedValue(emptyPlan()),
    setWeeklyPlanSlot: vi.fn().mockResolvedValue({ weekday: 1, outfit_id: "o-1" }),
    clearWeeklyPlanSlot: vi.fn().mockResolvedValue(null),
    clearWeeklyPlan: vi.fn().mockResolvedValue(null),
    listOutfits: vi.fn().mockResolvedValue([office]),
    ...overrides,
  };
}

function renderPlanner(repository, props = {}) {
  return render(
    <WeekPlanner
      repository={repository}
      active
      onLoad={props.onLoad ?? vi.fn()}
      onWear={props.onWear ?? vi.fn()}
      advancedFilter={emptyAdvancedFilter()}
      onAdvancedFilterChange={vi.fn()}
      today={props.today ?? { getDay: () => 3 }}
    />,
  );
}

describe("WeekPlanner", () => {
  it("renders exactly Monday through Friday with no weekend or dates", async () => {
    renderPlanner(plannerRepo());
    await screen.findByRole("button", { name: "Välj outfit för Måndag" });

    for (const day of ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag"]) {
      expect(screen.getByRole("heading", { name: day })).toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { name: "Lördag" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Söndag" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Min vecka" })).toBeInTheDocument();
  });

  it("shows empty and planned states with the correct actions", async () => {
    renderPlanner(plannerRepo({ listWeeklyPlan: vi.fn().mockResolvedValue(planWith({ 1: office })) }));

    expect(await screen.findByRole("button", { name: "Öppna Office" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Byt outfit för Måndag" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ta bort outfit från Måndag" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Välj outfit för Tisdag" })).toBeInTheDocument();
  });

  it("shows a retry action on a failed initial load and reloads on retry", async () => {
    const user = userEvent.setup();
    const repository = plannerRepo();
    repository.listWeeklyPlan
      .mockRejectedValueOnce(new Error("Kunde inte ladda veckan."))
      .mockResolvedValue(emptyPlan());
    renderPlanner(repository);

    expect(await screen.findByRole("alert")).toHaveTextContent("Kunde inte ladda veckan.");
    await user.click(screen.getByRole("button", { name: "Försök igen" }));

    expect(await screen.findByRole("button", { name: "Välj outfit för Måndag" })).toBeInTheDocument();
  });

  it("opens the picker, assigns an outfit, and reloads the plan", async () => {
    const user = userEvent.setup();
    const repository = plannerRepo();
    repository.listWeeklyPlan
      .mockResolvedValueOnce(emptyPlan())
      .mockResolvedValue(planWith({ 1: office }));
    renderPlanner(repository);

    await user.click(await screen.findByRole("button", { name: "Välj outfit för Måndag" }));
    await user.click(await screen.findByRole("button", { name: "Välj Office för Måndag" }));

    await waitFor(() => expect(repository.setWeeklyPlanSlot).toHaveBeenCalledWith({ weekday: 1, outfitId: "o-1" }));
    expect(await screen.findByRole("button", { name: "Öppna Office" })).toBeInTheDocument();
  });

  it("opens the picker to replace a planned outfit", async () => {
    const user = userEvent.setup();
    renderPlanner(plannerRepo({ listWeeklyPlan: vi.fn().mockResolvedValue(planWith({ 1: office })) }));
    await screen.findByRole("button", { name: "Öppna Office" });

    await user.click(screen.getByRole("button", { name: "Byt outfit för Måndag" }));

    expect(await screen.findByRole("dialog", { name: "Välj outfit för Måndag" })).toBeInTheDocument();
  });

  it("removes one weekday scoped to that day and reloads", async () => {
    const user = userEvent.setup();
    const repository = plannerRepo();
    repository.listWeeklyPlan
      .mockResolvedValueOnce(planWith({ 1: office }))
      .mockResolvedValue(emptyPlan());
    renderPlanner(repository);
    await screen.findByRole("button", { name: "Öppna Office" });

    await user.click(screen.getByRole("button", { name: "Ta bort outfit från Måndag" }));

    await waitFor(() => expect(repository.clearWeeklyPlanSlot).toHaveBeenCalledWith(1));
    expect(await screen.findByRole("button", { name: "Välj outfit för Måndag" })).toBeInTheDocument();
  });

  it("preserves the confirmed plan when a mutation fails", async () => {
    const user = userEvent.setup();
    const repository = plannerRepo({
      setWeeklyPlanSlot: vi.fn().mockRejectedValue(new Error("Sparningen misslyckades")),
    });
    repository.listWeeklyPlan.mockResolvedValue(emptyPlan());
    renderPlanner(repository);

    await user.click(await screen.findByRole("button", { name: "Välj outfit för Måndag" }));
    await user.click(await screen.findByRole("button", { name: "Välj Office för Måndag" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sparningen misslyckades");
    expect(screen.getByRole("button", { name: "Välj outfit för Måndag" })).toBeInTheDocument();
    // Only the initial load ran; the failed write never replaced the plan.
    expect(repository.listWeeklyPlan).toHaveBeenCalledTimes(1);
  });

  it("clears the whole week only after confirmation", async () => {
    const user = userEvent.setup();
    const repository = plannerRepo();
    repository.listWeeklyPlan
      .mockResolvedValueOnce(planWith({ 1: office }))
      .mockResolvedValue(emptyPlan());
    renderPlanner(repository);
    await screen.findByRole("button", { name: "Öppna Office" });

    await user.click(screen.getByRole("button", { name: "Töm veckan" }));
    expect(screen.getByRole("group", { name: "Töm veckan" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Töm veckan" }));

    await waitFor(() => expect(repository.clearWeeklyPlan).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "Välj outfit för Måndag" })).toBeInTheDocument();
  });

  it("cancels a clear without calling the repository", async () => {
    const user = userEvent.setup();
    const repository = plannerRepo({ listWeeklyPlan: vi.fn().mockResolvedValue(planWith({ 1: office })) });
    renderPlanner(repository);
    await screen.findByRole("button", { name: "Öppna Office" });

    await user.click(screen.getByRole("button", { name: "Töm veckan" }));
    await user.click(screen.getByRole("button", { name: "Avbryt" }));

    expect(repository.clearWeeklyPlan).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Töm veckan" })).toBeInTheDocument();
  });

  it("preserves the plan when clearing fails", async () => {
    const user = userEvent.setup();
    const repository = plannerRepo({
      listWeeklyPlan: vi.fn().mockResolvedValue(planWith({ 1: office })),
      clearWeeklyPlan: vi.fn().mockRejectedValue(new Error("Kunde inte tömma")),
    });
    renderPlanner(repository);
    await screen.findByRole("button", { name: "Öppna Office" });

    await user.click(screen.getByRole("button", { name: "Töm veckan" }));
    await user.click(screen.getByRole("button", { name: "Töm veckan" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Kunde inte tömma");
    expect(screen.getByRole("button", { name: "Öppna Office" })).toBeInTheDocument();
  });

  it("blocks wearing a Needs-attention outfit but still allows open/replace/remove", async () => {
    renderPlanner(
      plannerRepo({ listWeeklyPlan: vi.fn().mockResolvedValue(planWith({ 1: brokenOutfit })) }),
      { today: { getDay: () => 1 } },
    );
    await screen.findByText("Behöver åtgärdas");

    expect(screen.queryByRole("button", { name: "Bär Broken idag" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Öppna Broken" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Byt outfit för Måndag" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ta bort outfit från Måndag" })).toBeInTheDocument();
  });

  it("shows Bär idag only on the current weekday and wears the exact outfit", async () => {
    const user = userEvent.setup();
    const onWear = vi.fn();
    renderPlanner(
      plannerRepo({ listWeeklyPlan: vi.fn().mockResolvedValue(planWith({ 1: office, 3: office })) }),
      { today: { getDay: () => 1 }, onWear },
    );
    await screen.findAllByRole("button", { name: "Öppna Office" });

    const wearButtons = screen.getAllByRole("button", { name: "Bär Office idag" });
    expect(wearButtons).toHaveLength(1);

    await user.click(wearButtons[0]);
    expect(onWear).toHaveBeenCalledWith(office.items, office);
  });

  it("shows no wear action on a weekend", async () => {
    renderPlanner(
      plannerRepo({ listWeeklyPlan: vi.fn().mockResolvedValue(planWith({ 1: office })) }),
      { today: { getDay: () => 6 } },
    );
    await screen.findByRole("button", { name: "Öppna Office" });

    expect(screen.queryByRole("button", { name: "Bär Office idag" })).not.toBeInTheDocument();
  });

  it("opens a planned outfit in the dressing-room load flow", async () => {
    const user = userEvent.setup();
    const onLoad = vi.fn();
    renderPlanner(
      plannerRepo({ listWeeklyPlan: vi.fn().mockResolvedValue(planWith({ 1: office })) }),
      { onLoad },
    );

    await user.click(await screen.findByRole("button", { name: "Öppna Office" }));

    expect(onLoad).toHaveBeenCalledWith(office.items, office);
  });
});
