import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  selectAuditSample,
  writeBatchReports,
  writeContactSheet,
} from "../../scripts/wearit-images/report.mjs";
import {
  initializeBatch,
  updateItem,
} from "../../scripts/wearit-images/state.mjs";

const CLI = path.resolve("scripts/wearit-images/batch.mjs");
const ACCEPTED_ID = "11111111-1111-4111-8111-111111111111";
const QUARANTINED_ID = "22222222-2222-4222-8222-222222222222";
const FAILED_ID = "33333333-3333-4333-8333-333333333333";

async function image(file, color, width = 40, height = 50) {
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color,
    },
  }).png().toFile(file);
}

function runCli(arguments_, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [CLI, ...arguments_], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(expectedStatus);
  if (expectedStatus !== 0) {
    expect(result.stdout).toBe("");
    return result;
  }
  expect(result.stderr).toBe("");
  expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
  return JSON.parse(result.stdout);
}

describe("audit sampling", () => {
  it("is stable across input order and ranks by item id", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
      id: `item-${String(index + 1).padStart(2, "0")}`,
    }));

    const forward = selectAuditSample(items, 0.1).map(({ id }) => id);
    const reverse = selectAuditSample([...items].reverse(), 0.1)
      .map(({ id }) => id);

    expect(forward).toEqual(reverse);
    expect(forward).toHaveLength(2);
  });

  it("selects one of one accepted item", () => {
    expect(selectAuditSample([{ id: "only" }])).toEqual([{ id: "only" }]);
  });

  it("selects none when there are no accepted items", () => {
    expect(selectAuditSample([])).toEqual([]);
  });
});

describe("batch quality reports", () => {
  let root;
  let workspace;
  let input;
  let acceptedAttempt;
  let acceptedPreview;
  let quarantinedAttempt;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "wearit-report-"));
    workspace = path.join(root, "workspace");
    input = path.join(root, "unprocessed", "Jackets");
    await mkdir(path.join(workspace, "attempts"), { recursive: true });
    await mkdir(path.join(workspace, "audit", "contact-sheets"), {
      recursive: true,
    });
    await mkdir(path.join(workspace, "reports"), { recursive: true });
    await mkdir(input, { recursive: true });

    acceptedAttempt = path.join(workspace, "attempts", "accepted-v1.png");
    acceptedPreview = path.join(workspace, "attempts", "accepted-preview.png");
    quarantinedAttempt = path.join(
      workspace,
      "attempts",
      "quarantined-v1.png",
    );
    await Promise.all([
      image(path.join(input, "raw-accepted.png"), "#cc3344ff", 600, 800),
      image(path.join(input, "raw-quarantined.png"), "#3355ccff", 600, 800),
      image(path.join(input, "raw-failed.png"), "#999999ff", 600, 800),
      image(acceptedAttempt, "#cc3344ff"),
      image(acceptedPreview, "#eeeeeeff"),
      image(quarantinedAttempt, "#3355ccff"),
    ]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function state() {
    const source = (file) => ({
      path: path.join(input, file),
      role: "front",
      size: 1,
      sha256: "a".repeat(64),
    });
    const attempt = (kind, file, version = 1) => ({
      kind,
      path: file,
      version,
      generated: true,
    });
    return {
      version: 3,
      batchSlug: "quality-run",
      workspacePath: workspace,
      updatedAt: "2026-07-29T08:00:00.000Z",
      policy: { auditRate: 1 },
      infrastructureErrors: [{
        name: "SharpError",
        message: "decoder unavailable",
      }],
      items: [
        {
          id: ACCEPTED_ID,
          slug: "accepted-jacket",
          name: "Accepted <script>alert(1)</script>",
          status: "accepted",
          sources: [source("raw-accepted.png")],
          generationAttempts: 2,
          deterministicAttempts: { cleanup: 1, placement: 0 },
          attempts: [attempt("product-image", acceptedAttempt)],
          placement: {
            preview: acceptedPreview,
            metrics: {
              uncoveredCriticalRegions: [],
              forbiddenRegionViolations: [],
              clippingFraction: 0,
            },
          },
          review: {
            regions: {
              zipper: {
                status: "pass",
                confidence: 0.99,
                reason: "zipper <looks good>",
              },
            },
          },
          decision: {
            decision: "accept",
            reason: "all-critical-regions-pass",
          },
        },
        {
          id: QUARANTINED_ID,
          slug: "quarantined-jacket",
          name: "Quarantined & jacket",
          status: "quarantined",
          sources: [source("raw-quarantined.png")],
          generationAttempts: 3,
          deterministicAttempts: { cleanup: 1, placement: 1 },
          attempts: [attempt("wear-layer", quarantinedAttempt)],
          placement: {
            metrics: {
              uncoveredCriticalRegions: ["collar"],
              forbiddenRegionViolations: ["face"],
              clippingFraction: 0.2,
            },
          },
          review: {
            regions: {
              collar: {
                status: "fail",
                confidence: 0.6,
                reason: "collar <unsafe>",
              },
            },
          },
          quarantine: {
            at: "2026-07-29T07:00:00.000Z",
            decision: "quarantine",
            reason: "generation-budget-exhausted <unsafe>",
            failedRegions: ["collar"],
          },
        },
        {
          id: FAILED_ID,
          slug: "failed-jacket",
          name: "Failed jacket",
          status: "failed-infrastructure",
          sources: [source("raw-failed.png")],
          generationAttempts: 1,
          deterministicAttempts: { cleanup: 0, placement: 0 },
          attempts: [],
          review: null,
        },
      ],
    };
  }

  it("writes a contact sheet and reports missing optional images", async () => {
    const output = path.join(workspace, "audit", "contact-sheets", "one.jpg");
    const result = await writeContactSheet({
      sources: [acceptedAttempt],
      attempts: [path.join(workspace, "missing-attempt.png")],
      preview: acceptedPreview,
      output,
    });

    expect(result).toMatchObject({
      output,
      included: 2,
      missing: [path.join(workspace, "missing-attempt.png")],
    });
    await expect(sharp(output).metadata()).resolves.toMatchObject({
      format: "jpeg",
    });

    await expect(writeContactSheet({
      sources: [acceptedAttempt],
      attempts: [],
      preview: acceptedPreview,
      output,
    })).resolves.toMatchObject({ output, included: 2 });
  });

  it("writes deterministic JSON, Markdown, audit evidence, and escaped review HTML", async () => {
    const first = await writeBatchReports({
      state: state(),
      workspaceDir: workspace,
    });
    const firstHtml = await readFile(first.paths.reviewHtml, "utf8");
    const firstJson = await readFile(first.paths.json, "utf8");

    expect(first).toMatchObject({
      reviewHtml: first.paths.reviewHtml,
      auditItemIds: [ACCEPTED_ID],
      counts: {
        accepted: 1,
        quarantined: 1,
        "failed-infrastructure": 1,
        retries: 6,
        generationAttempts: 6,
        deterministicAttempts: {
          cleanup: 2,
          placement: 1,
          total: 3,
        },
      },
      auditIds: [ACCEPTED_ID],
    });
    expect(JSON.parse(firstJson)).toMatchObject({
      batchSlug: "quality-run",
      counts: first.counts,
      items: [
        {
          id: ACCEPTED_ID,
          status: "accepted",
          reason: "all-critical-regions-pass",
          regions: {
            zipper: {
              status: "pass",
              reason: "zipper <looks good>",
            },
          },
        },
        {
          id: QUARANTINED_ID,
          status: "quarantined",
          reason: "generation-budget-exhausted <unsafe>",
          failedRegions: ["collar", "face"],
          attempts: [{ kind: "wear-layer", version: 1 }],
        },
        {
          id: FAILED_ID,
          status: "failed-infrastructure",
        },
      ],
    });

    expect(firstHtml).toContain("<h2>Accepted</h2>");
    expect(firstHtml).toContain("<h2>Audit sample</h2>");
    expect(firstHtml).toContain("<h2>Quarantine</h2>");
    expect(firstHtml).toContain("Accepted: 1");
    expect(firstHtml).toContain("Quarantined: 1");
    expect(firstHtml).toContain("Failed infrastructure: 1");
    expect(firstHtml).toContain("Acceptance rate: 33.3%");
    expect(firstHtml).toContain("Quarantine rate: 33.3%");
    expect(firstHtml).toContain("Infrastructure-failure rate: 33.3%");
    expect(firstHtml).toContain("Accepted &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(firstHtml).not.toContain("<script>");
    expect(firstHtml).toContain("generation-budget-exhausted &lt;unsafe&gt;");
    expect(firstHtml).toContain("collar &lt;unsafe&gt;");
    expect(firstHtml).toContain("wear-layer v1");
    expect(firstHtml).not.toContain(path.join(input, "raw-accepted.png"));
    expect(firstHtml).not.toContain("data:image");
    expect(
      JSON.parse(await readFile(first.paths.auditSample, "utf8")),
    ).toEqual({
      rate: 1,
      count: 1,
      ids: [ACCEPTED_ID],
    });

    const auditFiles = await readdir(path.join(workspace, "audit"), {
      recursive: true,
    });
    expect(auditFiles).not.toContain("raw-accepted.png");
    expect(auditFiles).not.toContain("raw-quarantined.png");

    const second = await writeBatchReports({
      state: state(),
      workspaceDir: workspace,
    });
    expect(second).toEqual(first);
    expect(await readFile(second.paths.reviewHtml, "utf8")).toBe(firstHtml);
    expect(await readFile(second.paths.json, "utf8")).toBe(firstJson);
  });

  it("renders zero rates for an empty batch", async () => {
    const emptyState = {
      ...state(),
      items: [],
      infrastructureErrors: [],
    };
    const result = await writeBatchReports({
      state: emptyState,
      workspaceDir: workspace,
    });
    const html = await readFile(result.reviewHtml, "utf8");

    expect(result.auditItemIds).toEqual([]);
    expect(html).toContain("Accepted: 0");
    expect(html).toContain("Quarantined: 0");
    expect(html).toContain("Failed infrastructure: 0");
    expect(html).toContain("Acceptance rate: 0%");
    expect(html).toContain("Quarantine rate: 0%");
    expect(html).toContain("Infrastructure-failure rate: 0%");
  });

  it("reports attempt and one-shot metrics per category", async () => {
    const mixed = state();
    mixed.items[0] = {
      ...mixed.items[0],
      category: "top",
      deterministicAttempts: { cleanup: 0, placement: 0 },
      attempts: [
        ...mixed.items[0].attempts,
        {
          kind: "wear-layer",
          path: acceptedPreview,
          version: 1,
          generated: true,
        },
      ],
    };
    mixed.items[1] = { ...mixed.items[1], category: "shoes" };
    mixed.items[2] = { ...mixed.items[2], category: "hat" };

    const result = await writeBatchReports({ state: mixed, workspaceDir: workspace });

    expect(result.counts.oneShot).toBe(1);
    expect(result.counts.byCategory).toEqual({
      hat: {
        total: 1,
        accepted: 0,
        quarantined: 0,
        failedInfrastructure: 1,
        productAttempts: 0,
        wearAttempts: 0,
        oneShot: 0,
      },
      shoes: {
        total: 1,
        accepted: 0,
        quarantined: 1,
        failedInfrastructure: 0,
        productAttempts: 0,
        wearAttempts: 1,
        oneShot: 0,
      },
      top: {
        total: 1,
        accepted: 1,
        quarantined: 0,
        failedInfrastructure: 0,
        productAttempts: 1,
        wearAttempts: 1,
        oneShot: 1,
      },
    });
    const json = JSON.parse(await readFile(result.paths.json, "utf8"));
    expect(json.counts.byCategory).toEqual(result.counts.byCategory);
    expect(json.items[0]).toMatchObject({
      productAttempts: 1,
      wearAttempts: 1,
      oneShot: true,
    });
  });

  it("exposes report through the CLI and rejects replaced managed directories", async () => {
    const cliWorkspace = path.join(root, "cli-workspace");
    const intake = [{
      id: ACCEPTED_ID,
      slug: "cli-jacket",
      name: "CLI jacket",
      sources: [{ file: "raw-accepted.png", role: "front" }],
    }];
    await initializeBatch({
      inputDir: input,
      workspaceDir: cliWorkspace,
      batchSlug: "cli-workspace",
      intake,
    });
    const stateFile = path.join(cliWorkspace, "run-state.json");
    await updateItem(stateFile, ACCEPTED_ID, (item) => ({
      ...item,
      status: "accepted",
      decision: {
        decision: "accept",
        reason: "all-critical-regions-pass",
      },
    }));

    const first = runCli(["report", "--workspace", cliWorkspace]);
    expect(first).toMatchObject({
      command: "report",
      reviewHtml: first.paths.reviewHtml,
      auditItemIds: [ACCEPTED_ID],
      counts: {
        accepted: 1,
        quarantined: 0,
        "failed-infrastructure": 0,
      },
      auditIds: [ACCEPTED_ID],
    });
    expect(Object.keys(first.paths).sort()).toEqual([
      "auditSample",
      "json",
      "markdown",
      "reviewHtml",
    ]);
    expect(runCli(["report", "--workspace", cliWorkspace])).toEqual(first);

    const outside = path.join(root, "outside-reports");
    await mkdir(outside);
    await rm(path.join(cliWorkspace, "reports"), { recursive: true });
    await symlink(outside, path.join(cliWorkspace, "reports"), "dir");
    const rejected = runCli(["report", "--workspace", cliWorkspace], 1);
    expect(rejected.stderr).toMatch(/managed.*symlink/i);
    expect(await readdir(outside)).toEqual([]);
  });
});
