import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { fork } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializeBatch,
  loadBatch,
  recordInfrastructureFailure,
  updateItem,
} from "../../scripts/wearit-images/state.mjs";

const UPDATE_WORKER = path.resolve(
  "tests/wearit-images/fixtures/update-worker.mjs",
);

describe("autonomous batch state", () => {
  const roots = [];
  const children = new Set();

  afterEach(async () => {
    vi.useRealTimers();
    const activeChildren = [...children];
    const exits = activeChildren.map((child) =>
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once("exit", resolve)),
    );
    for (const child of activeChildren) {
      child.kill("SIGKILL");
    }
    await Promise.all(exits);
    await Promise.all(
      roots.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  async function makeRoot() {
    const root = await mkdtemp(path.join(os.tmpdir(), "wearit-state-"));
    roots.push(root);
    return root;
  }

  function intake(overrides = {}) {
    return [{
      id: "11111111-1111-4111-8111-111111111111",
      slug: "black-jacket",
      name: "Black jacket",
      sources: [{ file: "front.jpg", role: "front" }],
      ...overrides,
    }];
  }

  async function makeOptions() {
    const root = await makeRoot();
    const inputDir = path.join(root, "unprocessed", "Jackets");
    const workspaceDir = path.join(
      root,
      "data",
      "import-work",
      "jackets-auto",
    );
    await mkdir(inputDir, { recursive: true });
    await writeFile(path.join(inputDir, "front.jpg"), "new source");
    return {
      root,
      options: {
        inputDir,
        workspaceDir,
        batchSlug: "jackets-auto",
        intake: intake(),
        now: "2026-07-29T10:00:00.000Z",
      },
    };
  }

  async function makeTwoItemOptions() {
    const fixture = await makeOptions();
    await writeFile(
      path.join(fixture.options.inputDir, "detail.jpg"),
      "second source",
    );
    fixture.options.intake = [
      ...fixture.options.intake,
      {
        id: "22222222-2222-4222-8222-222222222222",
        slug: "navy-jacket",
        name: "Navy jacket",
        sources: [{ file: "detail.jpg", role: "detail" }],
      },
    ];
    return fixture;
  }

  function startWorker(arguments_) {
    const child = fork(UPDATE_WORKER, arguments_, {
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    children.add(child);
    const queued = [];
    const waiters = new Map();

    child.on("message", (message) => {
      const waiter = waiters.get(message.type);
      if (waiter) {
        waiters.delete(message.type);
        waiter.resolve(message);
      } else {
        queued.push(message);
      }
    });

    const exited = new Promise((resolve, reject) => {
      child.once("exit", (code, signal) => {
        children.delete(child);
        const error = new Error(
          `Update worker exited with code ${code} and signal ${signal}`,
        );
        for (const waiter of waiters.values()) waiter.reject(error);
        waiters.clear();
        if (code === 0) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
    exited.catch(() => {});

    return {
      child,
      exited,
      wait(type) {
        const index = queued.findIndex((message) => message.type === type);
        if (index !== -1) {
          return Promise.resolve(queued.splice(index, 1)[0]);
        }
        return new Promise((resolve, reject) => {
          waiters.set(type, { resolve, reject });
        });
      },
    };
  }

  function startUpdateWorker(stateFile, itemId, status) {
    return startWorker([stateFile, itemId, status]);
  }

  async function exists(file) {
    try {
      await lstat(file);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  async function makeOld(file) {
    const old = new Date(Date.now() - 60_000);
    await utimes(file, old, old);
  }

  async function settleLockTimeout(promise) {
    await vi.advanceTimersByTimeAsync(11_000);
    return promise;
  }

  it("builds fresh state only from the explicit Jackets intake", async () => {
    const { root, options } = await makeOptions();
    const oldWorkspace = path.join(root, "data", "import-work", "old");
    await mkdir(oldWorkspace, { recursive: true });
    await writeFile(path.join(oldWorkspace, "accepted.png"), "old output");

    const state = await initializeBatch(options);

    expect(state).toMatchObject({
      version: 3,
      batchSlug: "jackets-auto",
      inputPath: await realpath(options.inputDir),
      workspacePath: await realpath(options.workspaceDir),
      createdAt: "2026-07-29T10:00:00.000Z",
      updatedAt: "2026-07-29T10:00:00.000Z",
      stage: "processing",
      policy: {
        category: "Jackets",
        maxGenerationAttempts: 3,
        acceptanceConfidence: 0.9,
        auditRate: 0.1,
        reuseEarlierOutput: false,
      },
      infrastructureErrors: [],
    });
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      slug: "black-jacket",
      name: "Black jacket",
      category: "jacket",
      generationAttempts: 0,
      status: "ready",
      acceptedAssets: {},
      attempts: [],
      placement: null,
      review: null,
      quarantine: null,
    });
    expect(state.items[0].sources).toEqual([{
      path: await realpath(path.join(options.inputDir, "front.jpg")),
      role: "front",
      size: Buffer.byteLength("new source"),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }]);
    expect(JSON.stringify(state)).not.toContain("accepted.png");
    expect(await readdir(options.workspaceDir)).toEqual(expect.arrayContaining([
      "accepted",
      "attempts",
      "audit",
      "quarantine",
      "reports",
      "run-state.json",
    ]));
    expect((await readdir(oldWorkspace)).sort()).toEqual(["accepted.png"]);
  });

  it("rejects changed sources when resuming", async () => {
    const { options } = await makeOptions();
    await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    await writeFile(path.join(options.inputDir, "front.jpg"), "changed");

    await expect(initializeBatch(options)).rejects.toThrow(
      new RegExp(`source drift.*${path.basename(stateFile)}.*front\\.jpg`, "i"),
    );
  });

  it("wraps malformed JSON errors with the state path", async () => {
    const { options } = await makeOptions();
    await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    await writeFile(stateFile, "{");

    await expect(loadBatch(stateFile)).rejects.toThrow(
      new RegExp(`malformed.*${path.basename(stateFile)}`, "i"),
    );
  });

  it.each([
    ["input", async ({ options }) => {
      await rm(options.inputDir, { recursive: true });
    }],
    ["workspace", async ({ root, state }) => {
      state.workspacePath = path.join(root, "missing-workspace");
    }],
  ])("wraps missing canonical %s errors with the state path", async (
    field,
    arrange,
  ) => {
    const { root, options } = await makeOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    await arrange({ root, options, state });
    await writeFile(stateFile, JSON.stringify(state));

    await expect(loadBatch(stateFile)).rejects.toThrow(
      new RegExp(`invalid batch state.*${path.basename(stateFile)}.*${field}`, "i"),
    );
  });

  it("updates one item atomically without losing accepted sibling state", async () => {
    const { options } = await makeTwoItemOptions();
    const initialized = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    await updateItem(
      stateFile,
      initialized.items[0].id,
      (item) => ({ ...item, status: "accepted" }),
    );

    await updateItem(
      stateFile,
      initialized.items[1].id,
      (item) => ({ ...item, status: "quarantined" }),
    );

    const state = await loadBatch(stateFile);
    expect(state.items.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: initialized.items[0].id, status: "accepted" },
      { id: initialized.items[1].id, status: "quarantined" },
    ]);
    expect(JSON.parse(await readFile(stateFile, "utf8")).version).toBe(3);
    expect(
      (await readdir(options.workspaceDir))
        .filter((name) => name.includes(".tmp")),
    ).toEqual([]);
  });

  it("preserves concurrent cross-process item updates", async () => {
    const { options } = await makeTwoItemOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    const lockPath = `${stateFile}.lock`;
    const first = startUpdateWorker(
      stateFile,
      state.items[0].id,
      "reviewing",
    );
    await first.wait("started");
    await first.wait("entered");

    const second = startUpdateWorker(
      stateFile,
      state.items[1].id,
      "reviewing",
    );
    await second.wait("started");

    if (await exists(lockPath)) {
      first.child.send({ type: "continue" });
      await first.wait("done");
      await first.exited;
      await second.wait("entered");
      second.child.send({ type: "continue" });
      await second.wait("done");
      await second.exited;
    } else {
      await second.wait("entered");
      second.child.send({ type: "continue" });
      await second.wait("done");
      await second.exited;
      first.child.send({ type: "continue" });
      await first.wait("done");
      await first.exited;
    }

    expect((await loadBatch(stateFile)).items.map((item) => item.status)).toEqual([
      "reviewing",
      "reviewing",
    ]);
  });

  it("recovers only an old lock whose owning process is dead", async () => {
    const { options } = await makeOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    const lockPath = `${stateFile}.lock`;
    await mkdir(lockPath);
    await writeFile(path.join(lockPath, "owner.json"), JSON.stringify({
      pid: 2_147_483_647,
      token: "dead-owner",
      createdAtMs: Date.now() - 60_000,
    }));

    await updateItem(
      stateFile,
      state.items[0].id,
      (item) => ({ ...item, status: "reviewing" }),
    );

    expect((await loadBatch(stateFile)).items[0].status).toBe("reviewing");
    expect(await exists(lockPath)).toBe(false);
  });

  it("recovers an old ownerless lock after an identity recheck", async () => {
    vi.useFakeTimers();
    const { options } = await makeOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    const lockPath = `${stateFile}.lock`;
    await mkdir(lockPath);
    await makeOld(lockPath);

    await expect(settleLockTimeout(updateItem(
      stateFile,
      state.items[0].id,
      (item) => ({ ...item, status: "reviewing" }),
    ))).resolves.toMatchObject({
      items: [{ status: "reviewing" }],
    });
    expect(await exists(lockPath)).toBe(false);
  });

  it("recovers malformed lock ownership only after the lock is old", async () => {
    vi.useFakeTimers();
    const { options } = await makeOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    const lockPath = `${stateFile}.lock`;
    const ownerFile = path.join(lockPath, "owner.json");
    await mkdir(lockPath);
    await writeFile(ownerFile, "{");
    await makeOld(ownerFile);
    await makeOld(lockPath);

    await expect(settleLockTimeout(updateItem(
      stateFile,
      state.items[0].id,
      (item) => ({ ...item, status: "reviewing" }),
    ))).resolves.toMatchObject({
      items: [{ status: "reviewing" }],
    });
    expect(await exists(lockPath)).toBe(false);
  });

  it("does not recover a recent malformed lock", async () => {
    vi.useFakeTimers();
    const { options } = await makeOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    const lockPath = `${stateFile}.lock`;
    await mkdir(lockPath);
    await writeFile(path.join(lockPath, "owner.json"), "{");

    await expect(settleLockTimeout(updateItem(
      stateFile,
      state.items[0].id,
      (item) => ({ ...item, status: "reviewing" }),
    ))).rejects.toThrow(/timed out.*lock/i);
    expect(await exists(lockPath)).toBe(true);
  });

  it("never recovers an old lock owned by a live process", async () => {
    vi.useFakeTimers();
    const { options } = await makeOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    const lockPath = `${stateFile}.lock`;
    const owner = {
      pid: process.pid,
      token: "live-owner",
      createdAtMs: Date.now() - 60_000,
    };
    await mkdir(lockPath);
    await writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify(owner),
    );

    await expect(settleLockTimeout(updateItem(
      stateFile,
      state.items[0].id,
      (item) => ({ ...item, status: "reviewing" }),
    ))).rejects.toThrow(/timed out.*live.*pid/i);
    expect(JSON.parse(
      await readFile(path.join(lockPath, "owner.json"), "utf8"),
    )).toEqual(owner);
  });

  it("recovers an old reaper owned by a dead process", async () => {
    vi.useFakeTimers();
    const { options } = await makeOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    const reaperPath = `${stateFile}.lock.reaper`;
    await mkdir(reaperPath);
    await writeFile(path.join(reaperPath, "owner.json"), JSON.stringify({
      pid: 2_147_483_647,
      token: "dead-reaper",
      createdAtMs: Date.now() - 60_000,
    }));

    await expect(settleLockTimeout(updateItem(
      stateFile,
      state.items[0].id,
      (item) => ({ ...item, status: "reviewing" }),
    ))).resolves.toMatchObject({
      items: [{ status: "reviewing" }],
    });
    expect(await exists(reaperPath)).toBe(false);
  });

  it("recovers after a child dies with an old ownerless reaper guard", async () => {
    vi.useFakeTimers();
    const { options } = await makeOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    const reaperPath = `${stateFile}.lock.reaper`;
    const guardPath = `${reaperPath}.guard`;
    const worker = startWorker(["--hold-reaper", reaperPath]);
    await worker.wait("started");
    await worker.wait("entered");
    worker.child.kill("SIGKILL");
    await expect(worker.exited).rejects.toThrow(/SIGKILL/);

    const ownerFile = path.join(reaperPath, "owner.json");
    const owner = JSON.parse(await readFile(ownerFile, "utf8"));
    owner.createdAtMs = Date.now() - 60_000;
    await writeFile(ownerFile, JSON.stringify(owner));
    await makeOld(guardPath);

    await expect(settleLockTimeout(updateItem(
      stateFile,
      state.items[0].id,
      (item) => ({ ...item, status: "reviewing" }),
    ))).resolves.toMatchObject({
      items: [{ status: "reviewing" }],
    });
    expect(await exists(reaperPath)).toBe(false);
    expect(await exists(guardPath)).toBe(false);
  });

  it("removes an old ownerless guard without touching a fresh live reaper", async () => {
    vi.useFakeTimers();
    const { options } = await makeOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    const reaperPath = `${stateFile}.lock.reaper`;
    const guardPath = `${reaperPath}.guard`;
    const owner = {
      pid: process.pid,
      token: "fresh-live-reaper",
      createdAtMs: Date.now(),
    };
    await mkdir(reaperPath);
    await writeFile(
      path.join(reaperPath, "owner.json"),
      JSON.stringify(owner),
    );
    const reaperInode = (await lstat(reaperPath)).ino;
    await mkdir(guardPath);
    await makeOld(guardPath);

    await expect(settleLockTimeout(updateItem(
      stateFile,
      state.items[0].id,
      (item) => ({ ...item, status: "reviewing" }),
    ))).rejects.toThrow(/timed out.*lock/i);

    expect(await exists(guardPath)).toBe(false);
    expect((await lstat(reaperPath)).ino).toBe(reaperInode);
    expect(JSON.parse(
      await readFile(path.join(reaperPath, "owner.json"), "utf8"),
    )).toEqual(owner);
  });

  it("resumes after a child is terminated while holding the state lock", async () => {
    const { options } = await makeOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    const lockPath = `${stateFile}.lock`;
    const worker = startUpdateWorker(
      stateFile,
      state.items[0].id,
      "reviewing",
    );
    await worker.wait("started");
    await worker.wait("entered");
    worker.child.kill("SIGKILL");
    await expect(worker.exited).rejects.toThrow(/SIGKILL/);

    const ownerFile = path.join(lockPath, "owner.json");
    const owner = JSON.parse(await readFile(ownerFile, "utf8"));
    owner.createdAtMs = Date.now() - 60_000;
    await writeFile(ownerFile, JSON.stringify(owner));

    await updateItem(
      stateFile,
      state.items[0].id,
      (item) => ({ ...item, status: "reviewing" }),
    );
    expect((await loadBatch(stateFile)).items[0].status).toBe("reviewing");
    expect(await exists(lockPath)).toBe(false);
  });

  it.each([
    ["an absolute filename", "/tmp/front.jpg", /absolute/i],
    ["an escaping filename", "../front.jpg", /escape/i],
  ])("rejects %s", async (_description, file, expected) => {
    const { options } = await makeOptions();
    options.intake = intake({
      sources: [{ file, role: "front" }],
    });

    await expect(initializeBatch(options)).rejects.toThrow(expected);
  });

  it("rejects a source symlink outside the canonical input directory", async () => {
    const { root, options } = await makeOptions();
    const outside = path.join(root, "outside.jpg");
    await writeFile(outside, "outside");
    await symlink(outside, path.join(options.inputDir, "linked.jpg"));
    options.intake = intake({
      sources: [{ file: "linked.jpg", role: "front" }],
    });

    await expect(initializeBatch(options)).rejects.toThrow(/outside.*input/i);
  });

  it("does not create batch directories through workspace symlinks", async () => {
    const { root, options } = await makeOptions();
    const outside = path.join(root, "outside-workspace");
    await mkdir(outside);
    await mkdir(options.workspaceDir, { recursive: true });
    await symlink(outside, path.join(options.workspaceDir, "accepted"));

    await expect(initializeBatch(options)).rejects.toThrow(
      /workspace.*symlink/i,
    );
    await expect(
      lstat(path.join(outside, "product-images")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["ids", "id", /duplicate id/i],
    ["slugs", "slug", /duplicate slug/i],
  ])("rejects persisted state with duplicate %s on resume", async (
    _description,
    field,
    expected,
  ) => {
    const { options } = await makeTwoItemOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    state.items[1][field] = state.items[0][field];
    await writeFile(stateFile, JSON.stringify(state));

    await expect(initializeBatch(options)).rejects.toThrow(expected);
  });

  it("rejects persisted duplicate source membership on resume", async () => {
    const { options } = await makeTwoItemOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    state.items[1].sources = structuredClone(state.items[0].sources);
    await writeFile(stateFile, JSON.stringify(state));

    await expect(initializeBatch(options)).rejects.toThrow(/duplicate source/i);
  });

  it("rejects persisted sources outside the canonical input on load", async () => {
    const { root, options } = await makeOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    const outside = path.join(root, "outside.jpg");
    await writeFile(outside, "outside");
    state.items[0].sources[0].path = await realpath(outside);
    await writeFile(stateFile, JSON.stringify(state));

    await expect(loadBatch(stateFile)).rejects.toThrow(
      /source.*outside.*input/i,
    );
  });

  it.each([
    ["batchSlug", (state) => { delete state.batchSlug; }],
    ["inputPath", (state) => { state.inputPath = "Jackets"; }],
    ["input category", (state) => {
      state.inputPath = path.dirname(state.inputPath);
    }],
    ["workspacePath", (state) => { state.workspacePath = state.inputPath; }],
    ["createdAt", (state) => { state.createdAt = "not-a-date"; }],
    ["updatedAt", (state) => { delete state.updatedAt; }],
    ["stage", (state) => { state.stage = "unknown"; }],
    ["policy category", (state) => { state.policy.category = "Shirts"; }],
    ["policy attempts", (state) => { state.policy.maxGenerationAttempts = 0; }],
    ["policy confidence", (state) => { state.policy.acceptanceConfidence = 1.1; }],
    ["policy audit rate", (state) => { state.policy.auditRate = -0.1; }],
    ["policy reuse", (state) => { state.policy.reuseEarlierOutput = true; }],
    ["policy completeness", (state) => { delete state.policy.auditRate; }],
    ["infrastructureErrors", (state) => { state.infrastructureErrors = {}; }],
    ["item id", (state) => { state.items[0].id = ""; }],
    ["item slug", (state) => { state.items[0].slug = ""; }],
    ["item name", (state) => { state.items[0].name = ""; }],
    ["item category", (state) => { state.items[0].category = "shirt"; }],
    ["item status", (state) => { state.items[0].status = "unknown"; }],
    ["generationAttempts", (state) => { state.items[0].generationAttempts = -1; }],
    ["acceptedAssets", (state) => { state.items[0].acceptedAssets = []; }],
    ["attempts", (state) => { state.items[0].attempts = {}; }],
    ["placement", (state) => { state.items[0].placement = []; }],
    ["review", (state) => { state.items[0].review = []; }],
    ["quarantine", (state) => { state.items[0].quarantine = []; }],
    ["sources", (state) => { state.items[0].sources = []; }],
    ["source path", (state) => { state.items[0].sources[0].path = "front.jpg"; }],
    ["source role", (state) => { state.items[0].sources[0].role = ""; }],
    ["source size", (state) => { state.items[0].sources[0].size = -1; }],
    ["source sha256", (state) => { state.items[0].sources[0].sha256 = "nope"; }],
  ])("rejects invalid version-3 schema: %s", async (_field, corrupt) => {
    const { options } = await makeOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    corrupt(state);
    await writeFile(stateFile, JSON.stringify(state));

    await expect(loadBatch(stateFile)).rejects.toThrow();
  });

  it("rejects duplicate source membership, ids, and slugs", async () => {
    const { options } = await makeOptions();
    const baseItem = intake()[0];

    await expect(initializeBatch({
      ...options,
      intake: [{
        ...baseItem,
        sources: [
          { file: "front.jpg", role: "front" },
          { file: "front.jpg", role: "detail" },
        ],
      }],
    })).rejects.toThrow(/duplicate source/i);

    await expect(initializeBatch({
      ...options,
      intake: [
        baseItem,
        { ...baseItem, slug: "another-jacket" },
      ],
    })).rejects.toThrow(/duplicate id/i);

    await expect(initializeBatch({
      ...options,
      intake: [
        baseItem,
        { ...baseItem, id: "22222222-2222-4222-8222-222222222222" },
      ],
    })).rejects.toThrow(/duplicate slug/i);
  });

  it("does not let updateItem duplicate a sibling slug", async () => {
    const { options } = await makeTwoItemOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    const persistedBefore = await readFile(stateFile, "utf8");

    await expect(updateItem(
      stateFile,
      state.items[1].id,
      (item) => ({ ...item, slug: state.items[0].slug }),
    )).rejects.toThrow(/slug.*immutable|duplicate slug/i);

    expect(await readFile(stateFile, "utf8")).toBe(persistedBefore);
  });

  it("does not let updateItem duplicate sibling source membership", async () => {
    const { options } = await makeTwoItemOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    const persistedBefore = await readFile(stateFile, "utf8");

    await expect(updateItem(
      stateFile,
      state.items[1].id,
      (item) => ({ ...item, sources: structuredClone(state.items[0].sources) }),
    )).rejects.toThrow(/source.*immutable|duplicate source/i);

    expect(await readFile(stateFile, "utf8")).toBe(persistedBefore);
  });

  it("does not let updateItem move source metadata outside the input", async () => {
    const { root, options } = await makeTwoItemOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    const persistedBefore = await readFile(stateFile, "utf8");
    const outside = path.join(root, "outside.jpg");
    await writeFile(outside, "outside");

    await expect(updateItem(
      stateFile,
      state.items[1].id,
      (item) => ({
        ...item,
        sources: [{
          ...item.sources[0],
          path: outside,
        }],
      }),
    )).rejects.toThrow(/source.*immutable|outside.*input/i);

    expect(await readFile(stateFile, "utf8")).toBe(persistedBefore);
  });

  it("lets updateItem preserve identity while changing processing state", async () => {
    const { options } = await makeTwoItemOptions();
    const state = await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");
    const target = state.items[1];

    await updateItem(stateFile, target.id, (item) => ({
      ...item,
      status: "reviewing",
      attempts: [{ attempt: 1, outcome: "generated" }],
      review: { confidence: 0.94 },
    }));

    const updated = await loadBatch(stateFile);
    expect(updated.items[1]).toMatchObject({
      id: target.id,
      slug: target.slug,
      sources: target.sources,
      status: "reviewing",
      attempts: [{ attempt: 1, outcome: "generated" }],
      review: { confidence: 0.94 },
    });
  });

  it("rejects input directories outside the Jackets pilot category", async () => {
    const { options } = await makeOptions();
    const shirts = path.join(path.dirname(options.inputDir), "Shirts");
    await mkdir(shirts);
    await writeFile(path.join(shirts, "front.jpg"), "new source");

    await expect(initializeBatch({
      ...options,
      inputDir: shirts,
    })).rejects.toThrow(/Jackets/);
  });

  it.each([
    ["workspace inside input", (options) => {
      options.workspaceDir = path.join(options.inputDir, "workspace");
    }],
    ["input inside workspace", (options, root) => {
      options.workspaceDir = root;
    }],
  ])("rejects %s tree overlap", async (_description, arrange) => {
    const { root, options } = await makeOptions();
    arrange(options, root);

    await expect(initializeBatch(options)).rejects.toThrow(/overlap/i);
  });

  it("rejects stale managed output when creating a fresh batch", async () => {
    const { options } = await makeOptions();
    const staleDirectory = path.join(
      options.workspaceDir,
      "accepted",
      "product-images",
    );
    await mkdir(staleDirectory, { recursive: true });
    await writeFile(path.join(staleDirectory, "stale.png"), "old output");

    await expect(initializeBatch(options)).rejects.toThrow(
      /fresh workspace.*stale\.png/i,
    );
  });

  it("rejects stale managed directory structure without assets", async () => {
    const { options } = await makeOptions();
    await mkdir(
      path.join(options.workspaceDir, "accepted", "product-images"),
      { recursive: true },
    );

    await expect(initializeBatch(options)).rejects.toThrow(
      /fresh workspace.*accepted/i,
    );
  });

  it("allows intake.json as fresh-workspace bootstrap metadata", async () => {
    const { options } = await makeOptions();
    await mkdir(options.workspaceDir, { recursive: true });
    await writeFile(
      path.join(options.workspaceDir, "intake.json"),
      JSON.stringify(options.intake),
    );

    expect((await initializeBatch(options)).items[0].status).toBe("ready");
  });

  it.each([
    "run-state.json.lock.reaper.tombstone.4242.11111111-1111-4111-8111-111111111111",
    "run-state.json.lock.reaper.guard.tombstone.4242.11111111-1111-4111-8111-111111111111",
  ])("allows orphaned internal lock residue on fresh initialization: %s", async (
    tombstoneName,
  ) => {
    const { options } = await makeOptions();
    const tombstonePath = path.join(options.workspaceDir, tombstoneName);
    await mkdir(tombstonePath, { recursive: true });
    await writeFile(
      path.join(tombstonePath, "owner.json"),
      JSON.stringify({ pid: 4242, token: "orphaned" }),
    );

    expect((await initializeBatch(options)).items[0].status).toBe("ready");
  });

  it("does not broadly ignore lock-like fresh-workspace files", async () => {
    const { options } = await makeOptions();
    await mkdir(options.workspaceDir, { recursive: true });
    await writeFile(
      path.join(
        options.workspaceDir,
        "run-state.json.lock.reaper.tombstone.not-internal",
      ),
      "unexpected",
    );

    await expect(initializeBatch(options)).rejects.toThrow(
      /fresh workspace.*unexpected output/i,
    );
  });

  it.each(["accepted", "quarantined", "failed-infrastructure"])(
    "does not mutate a terminal %s item",
    async (status) => {
      const { options } = await makeOptions();
      const state = await initializeBatch(options);
      const stateFile = path.join(options.workspaceDir, "run-state.json");
      await updateItem(
        stateFile,
        state.items[0].id,
        (item) => ({ ...item, status }),
      );

      await expect(updateItem(
        stateFile,
        state.items[0].id,
        (item) => ({ ...item, status: "ready" }),
      )).rejects.toThrow(/terminal item/i);

      expect((await loadBatch(stateFile)).items[0].status).toBe(status);
    },
  );

  it("records infrastructure failures through an atomic state update", async () => {
    const { options } = await makeOptions();
    await initializeBatch(options);
    const stateFile = path.join(options.workspaceDir, "run-state.json");

    await recordInfrastructureFailure(
      stateFile,
      new Error("image service unavailable"),
    );

    const state = await loadBatch(stateFile);
    expect(state.infrastructureErrors).toHaveLength(1);
    expect(state.infrastructureErrors[0]).toMatchObject({
      name: "Error",
      message: "image service unavailable",
    });
    const persistedState = await readFile(stateFile, "utf8");
    expect(() => JSON.parse(persistedState)).not.toThrow();
    expect((await lstat(stateFile)).isFile()).toBe(true);
  });
});
