import { describe, expect, it, vi } from "vitest";
import { createWardrobeRepository } from "./wardrobeRepository.js";

function createQuery(result, single) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    upsert: vi.fn(() => query),
    delete: vi.fn(() => query),
    single: vi.fn(() => Promise.resolve(single ?? result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

function plannerClient({
  slotsResult = { data: [], error: null },
  rpcResult = { data: null, error: null },
  outfitsResult = { data: [], error: null },
  lastWornResult = { data: [], error: null },
  signedResult = { data: [], error: null },
  ownerId = "owner-1",
  getUser,
} = {}) {
  const slotsQuery = createQuery(slotsResult);
  const outfitsQuery = createQuery(outfitsResult);
  const lastWornQuery = createQuery(lastWornResult);
  const createSignedUrls = vi.fn().mockResolvedValue(signedResult);
  const from = vi.fn((table) => {
    if (table === "weekly_plan_slots") return slotsQuery;
    if (table === "outfit_last_worn") return lastWornQuery;
    return outfitsQuery;
  });
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const auth = {
    getUser: getUser
      ?? vi.fn().mockResolvedValue({ data: { user: { id: ownerId } }, error: null }),
  };
  return {
    client: { from, auth, rpc, storage: { from: vi.fn(() => ({ createSignedUrls })) } },
    from, slotsQuery, outfitsQuery, lastWornQuery, createSignedUrls, auth, rpc,
  };
}

function outfitRow(id, name, thumbnailPath) {
  return { id, name, thumbnail_path: thumbnailPath, needs_attention: false, outfit_items: [], outfit_labels: [] };
}

describe("weekly planner repository", () => {
  it("returns five weekday slots ordered Monday to Friday with signed outfits and last-worn", async () => {
    const { client, slotsQuery } = plannerClient({
      slotsResult: { data: [{ weekday: 5, outfit_id: "o-5" }, { weekday: 2, outfit_id: "o-2" }], error: null },
      outfitsResult: {
        data: [
          outfitRow("o-2", "Tuesday look", "owner-1/outfits/o-2/t.webp"),
          outfitRow("o-5", "Friday look", "owner-1/outfits/o-5/t.webp"),
        ],
        error: null,
      },
      lastWornResult: { data: [{ outfit_id: "o-2", last_worn_at: "2026-07-10T10:00:00Z" }], error: null },
      signedResult: {
        data: [
          { path: "owner-1/outfits/o-2/t.webp", signedUrl: "https://assets.test/o-2" },
          { path: "owner-1/outfits/o-5/t.webp", signedUrl: "https://assets.test/o-5" },
        ],
        error: null,
      },
    });

    const plan = await createWardrobeRepository(client).listWeeklyPlan();

    expect(client.from).toHaveBeenCalledWith("weekly_plan_slots");
    expect(slotsQuery.select).toHaveBeenCalledWith("weekday, outfit_id");
    expect(slotsQuery.order).toHaveBeenCalledWith("weekday", { ascending: true });
    expect(plan.map((slot) => slot.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(plan[0]).toEqual({ weekday: 1, outfitId: null, outfit: null });
    expect(plan[2]).toEqual({ weekday: 3, outfitId: null, outfit: null });
    expect(plan[1]).toMatchObject({
      weekday: 2,
      outfitId: "o-2",
      outfit: expect.objectContaining({
        id: "o-2",
        thumbnailUrl: "https://assets.test/o-2",
        last_worn_at: "2026-07-10T10:00:00Z",
      }),
    });
    expect(plan[4]).toMatchObject({
      weekday: 5,
      outfitId: "o-5",
      outfit: expect.objectContaining({
        id: "o-5",
        thumbnailUrl: "https://assets.test/o-5",
        last_worn_at: null,
      }),
    });
  });

  it("returns five empty slots when no plan rows exist", async () => {
    const { client } = plannerClient({ slotsResult: { data: [], error: null } });

    const plan = await createWardrobeRepository(client).listWeeklyPlan();

    expect(plan).toEqual([1, 2, 3, 4, 5].map((weekday) => ({ weekday, outfitId: null, outfit: null })));
  });

  it("empties a slot whose outfit is no longer present", async () => {
    const { client } = plannerClient({
      slotsResult: { data: [{ weekday: 1, outfit_id: "gone" }], error: null },
      outfitsResult: { data: [], error: null },
    });

    const plan = await createWardrobeRepository(client).listWeeklyPlan();

    expect(plan[0]).toEqual({ weekday: 1, outfitId: null, outfit: null });
  });

  it("flags a planned outfit when its last-worn view is unavailable", async () => {
    const { client } = plannerClient({
      slotsResult: { data: [{ weekday: 1, outfit_id: "o-1" }], error: null },
      outfitsResult: { data: [outfitRow("o-1", "Monday look", "owner-1/outfits/o-1/t.webp")], error: null },
      lastWornResult: { data: null, error: new Error("view down") },
      signedResult: { data: [{ path: "owner-1/outfits/o-1/t.webp", signedUrl: "https://assets.test/o-1" }], error: null },
    });

    const plan = await createWardrobeRepository(client).listWeeklyPlan();

    expect(plan[0].outfit).toMatchObject({ id: "o-1", last_worn_at: null, last_worn_unavailable: true });
  });

  it("propagates a database error from the slot query", async () => {
    const { client } = plannerClient({ slotsResult: { data: null, error: new Error("slots down") } });

    await expect(createWardrobeRepository(client).listWeeklyPlan()).rejects.toThrow("slots down");
  });

  it("sets a slot through the security-definer RPC", async () => {
    const { client, rpc } = plannerClient();

    await createWardrobeRepository(client).setWeeklyPlanSlot({ weekday: 1, outfitId: "o-1" });

    expect(rpc).toHaveBeenCalledWith("set_weekly_plan_slot", { p_weekday: 1, p_outfit_id: "o-1" });
  });

  it.each([0, 6, 7, 2.5, null])("rejects weekday %s before any I/O when setting a slot", async (weekday) => {
    const { client, rpc, from } = plannerClient();

    await expect(createWardrobeRepository(client).setWeeklyPlanSlot({ weekday, outfitId: "o-1" }))
      .rejects.toThrow("Weekday must be an integer from 1 to 5.");
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("propagates a database error from the RPC", async () => {
    const { client } = plannerClient({ rpcResult: { data: null, error: new Error("plan write failed") } });

    await expect(createWardrobeRepository(client).setWeeklyPlanSlot({ weekday: 1, outfitId: "o-1" }))
      .rejects.toThrow("plan write failed");
  });

  it("clears one weekday scoped to the owner", async () => {
    const { client, slotsQuery, auth } = plannerClient({ slotsResult: { data: null, error: null } });

    await createWardrobeRepository(client).clearWeeklyPlanSlot(3);

    expect(auth.getUser).toHaveBeenCalledTimes(1);
    expect(slotsQuery.delete).toHaveBeenCalledTimes(1);
    expect(slotsQuery.eq).toHaveBeenCalledWith("owner_id", "owner-1");
    expect(slotsQuery.eq).toHaveBeenCalledWith("weekday", 3);
  });

  it("rejects an invalid weekday before any I/O when clearing one slot", async () => {
    const { client, from, auth } = plannerClient();

    await expect(createWardrobeRepository(client).clearWeeklyPlanSlot(9))
      .rejects.toThrow("Weekday must be an integer from 1 to 5.");
    expect(from).not.toHaveBeenCalled();
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("clears the whole week scoped to the owner", async () => {
    const { client, slotsQuery, auth } = plannerClient({ slotsResult: { data: null, error: null } });

    await createWardrobeRepository(client).clearWeeklyPlan();

    expect(auth.getUser).toHaveBeenCalledTimes(1);
    expect(slotsQuery.delete).toHaveBeenCalledTimes(1);
    expect(slotsQuery.eq).toHaveBeenCalledWith("owner_id", "owner-1");
    expect(slotsQuery.eq).not.toHaveBeenCalledWith("weekday", expect.anything());
  });

  it("propagates a database error from clearing the week", async () => {
    const { client } = plannerClient({ slotsResult: { data: null, error: new Error("delete blocked") } });

    await expect(createWardrobeRepository(client).clearWeeklyPlan()).rejects.toThrow("delete blocked");
  });
});
