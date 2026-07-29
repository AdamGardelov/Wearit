import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const TERMINAL_COUNTS = [
  "accepted",
  "quarantined",
  "failed-infrastructure",
];
const THUMBNAIL_SIZE = 240;

function auditRank(id) {
  return createHash("sha256").update(`wearit-audit:${id}`).digest("hex");
}

export function selectAuditSample(acceptedItems, rate = 0.1) {
  if (!Array.isArray(acceptedItems)) {
    throw new TypeError("Accepted items must be an array");
  }
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new RangeError("Audit rate must be between 0 and 1");
  }
  if (acceptedItems.length === 0) return [];

  const count = Math.min(
    acceptedItems.length,
    Math.max(1, Math.ceil(acceptedItems.length * rate)),
  );
  return [...acceptedItems]
    .sort((left, right) => {
      const rankOrder = auditRank(left.id).localeCompare(auditRank(right.id));
      return rankOrder || String(left.id).localeCompare(String(right.id));
    })
    .slice(0, count);
}

function imagePath(value) {
  if (typeof value === "string") return value;
  return value?.path ?? value?.previewPath ?? null;
}

async function thumbnailBuffer(file) {
  return sharp(file)
    .rotate()
    .resize({
      width: THUMBNAIL_SIZE,
      height: THUMBNAIL_SIZE,
      fit: "contain",
      background: "#f4f1eb",
      withoutEnlargement: true,
    })
    .flatten({ background: "#f4f1eb" })
    .jpeg({ quality: 82, progressive: true })
    .toBuffer();
}

async function atomicWriteBuffer(file, contents) {
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, contents, { flag: "wx" });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function atomicWriteText(file, contents) {
  await atomicWriteBuffer(file, Buffer.from(contents, "utf8"));
}

export async function writeContactSheet({
  sources = [],
  attempts = [],
  preview = null,
  output,
}) {
  const candidates = [
    ...sources.map(imagePath),
    ...attempts.map(imagePath),
    imagePath(preview),
  ].filter(Boolean);
  const missing = [];
  const thumbnails = [];

  for (const file of candidates) {
    try {
      thumbnails.push(await thumbnailBuffer(file));
    } catch {
      missing.push(file);
    }
  }

  const columns = Math.min(3, Math.max(1, thumbnails.length));
  const rows = Math.max(1, Math.ceil(thumbnails.length / columns));
  const gap = 12;
  const cell = THUMBNAIL_SIZE;
  const width = columns * cell + (columns + 1) * gap;
  const height = rows * cell + (rows + 1) * gap;
  const composites = thumbnails.map((input, index) => ({
    input,
    left: gap + (index % columns) * (cell + gap),
    top: gap + Math.floor(index / columns) * (cell + gap),
  }));
  const sheet = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#ffffff",
    },
  }).composite(composites).jpeg({ quality: 85, progressive: true }).toBuffer();
  await atomicWriteBuffer(output, sheet);

  return {
    output,
    included: thumbnails.length,
    missing,
  };
}

function isContained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

async function validateManagedDirectory(workspacePath, directory) {
  const stat = await lstat(directory);
  if (stat.isSymbolicLink()) {
    throw new Error(`Managed workspace directory is a symlink: ${directory}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Managed workspace path is not a directory: ${directory}`);
  }
  const canonical = await realpath(directory);
  if (!isContained(workspacePath, canonical)) {
    throw new Error(`Managed directory escapes workspace: ${directory}`);
  }
  return canonical;
}

async function ensureManagedDirectory(workspacePath, segments) {
  let current = workspacePath;
  await validateManagedDirectory(workspacePath, current);
  for (const segment of segments) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segment)) {
      throw new Error(`Invalid managed directory segment: ${segment}`);
    }
    const candidate = path.join(current, segment);
    try {
      await validateManagedDirectory(workspacePath, candidate);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await validateManagedDirectory(workspacePath, current);
      await mkdir(candidate);
      await validateManagedDirectory(workspacePath, candidate);
    }
    current = candidate;
  }
  return current;
}

function safeSlug(item) {
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug ?? "")) {
    return item.slug;
  }
  return `item-${createHash("sha256")
    .update(String(item.id))
    .digest("hex")
    .slice(0, 16)}`;
}

function deterministicAttempts(item) {
  const cleanup = Number.isInteger(item.deterministicAttempts?.cleanup)
    ? item.deterministicAttempts.cleanup
    : 0;
  const placement = Number.isInteger(item.deterministicAttempts?.placement)
    ? item.deterministicAttempts.placement
    : 0;
  return { cleanup, placement, total: cleanup + placement };
}

function itemRetries(item) {
  const generationAttempts = Number.isInteger(item.generationAttempts)
    ? item.generationAttempts
    : 0;
  const deterministic = deterministicAttempts(item);
  return Math.max(0, generationAttempts - 1) + deterministic.total;
}

function uniqueRegions(item) {
  return [...new Set([
    ...(item.quarantine?.failedRegions ?? []),
    ...(item.quarantine?.structuralFailures ?? []),
    ...(item.placement?.metrics?.uncoveredCriticalRegions ?? []),
    ...(item.placement?.metrics?.forbiddenRegionViolations ?? []),
  ])];
}

function itemReason(item) {
  return item.quarantine?.reason
    ?? item.decision?.reason
    ?? item.decision?.error?.message
    ?? (item.status === "failed-infrastructure"
      ? "failed-infrastructure"
      : null);
}

function reportItem(item) {
  return {
    id: item.id,
    slug: item.slug,
    name: item.name,
    status: item.status,
    reason: itemReason(item),
    failedRegions: uniqueRegions(item),
    regions: item.review?.regions ?? {},
    generationAttempts: item.generationAttempts ?? 0,
    deterministicAttempts: deterministicAttempts(item),
    retries: itemRetries(item),
    attempts: (item.attempts ?? []).map((attempt) => ({
      kind: attempt.kind ?? null,
      version: attempt.version ?? null,
      generated: attempt.generated === true,
      path: attempt.path ?? null,
    })),
    placement: item.placement?.metrics ?? null,
  };
}

function reportCounts(items) {
  const counts = Object.fromEntries(TERMINAL_COUNTS.map((status) => [
    status,
    items.filter((item) => item.status === status).length,
  ]));
  counts.retries = items.reduce((total, item) => total + itemRetries(item), 0);
  counts.generationAttempts = items.reduce(
    (total, item) => total + (item.generationAttempts ?? 0),
    0,
  );
  const deterministic = items.map(deterministicAttempts);
  counts.deterministicAttempts = {
    cleanup: deterministic.reduce((total, value) => total + value.cleanup, 0),
    placement: deterministic.reduce(
      (total, value) => total + value.placement,
      0,
    ),
  };
  counts.deterministicAttempts.total = (
    counts.deterministicAttempts.cleanup
    + counts.deterministicAttempts.placement
  );
  return counts;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeMarkdown(value) {
  return String(value ?? "—")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function previewPath(item) {
  return item.placement?.preview
    ?? item.placement?.candidates?.[0]?.previewPath
    ?? null;
}

function relativeUrl(htmlFile, file) {
  const relative = path.relative(path.dirname(htmlFile), file);
  return relative.split(path.sep).map(encodeURIComponent).join("/");
}

async function writeThumbnail(source, output) {
  try {
    await atomicWriteBuffer(output, await thumbnailBuffer(source));
    return { output, missing: false };
  } catch {
    return { output: null, missing: true };
  }
}

function cardHtml(item, media, htmlFile) {
  const attempts = media.attempts.map(({ attempt, thumbnail }) => {
    const label = `${attempt.kind ?? "asset"} v${attempt.version ?? "?"}`;
    const image = thumbnail
      ? `<img src="${escapeHtml(relativeUrl(htmlFile, thumbnail))}" alt="${escapeHtml(label)} thumbnail">`
      : "";
    const link = attempt.path && media.links.has(attempt.path)
      ? `<a href="${escapeHtml(relativeUrl(htmlFile, attempt.path))}">${escapeHtml(label)}</a>`
      : escapeHtml(label);
    return `<li>${link}${image}</li>`;
  }).join("");
  const regions = Object.entries(item.review?.regions ?? {}).map(
    ([name, result]) =>
      `<li><strong>${escapeHtml(name)}</strong>: ${escapeHtml(result.status)}`
      + ` (${escapeHtml(result.confidence)}) — ${escapeHtml(result.reason)}</li>`,
  ).join("");
  const failedRegions = uniqueRegions(item).map(
    (region) => `<li>${escapeHtml(region)}</li>`,
  ).join("");
  const sourceImages = media.sources.map((file, index) =>
    `<img src="${escapeHtml(relativeUrl(htmlFile, file))}"`
    + ` alt="Source ${index + 1} thumbnail">`).join("");
  const preview = media.preview
    ? `<a href="${escapeHtml(relativeUrl(htmlFile, media.preview.original))}">`
      + `<img src="${escapeHtml(relativeUrl(htmlFile, media.preview.thumbnail))}"`
      + ` alt="Placement preview thumbnail"></a>`
    : "";
  const contactSheet = media.contactSheet
    ? `<img src="${escapeHtml(relativeUrl(htmlFile, media.contactSheet))}"`
      + ` alt="${escapeHtml(item.name)} contact sheet">`
    : "";

  return `<article>
    <h3>${escapeHtml(item.name)}</h3>
    <p><code>${escapeHtml(item.id)}</code> · ${escapeHtml(item.status)}</p>
    <p><strong>Reason:</strong> ${escapeHtml(itemReason(item) ?? "—")}</p>
    <div class="media">${sourceImages}${preview}${contactSheet}</div>
    <details><summary>Attempt history (${(item.attempts ?? []).length})</summary><ul>${attempts || "<li>None</li>"}</ul></details>
    <details><summary>Review regions</summary><ul>${regions || "<li>None</li>"}</ul></details>
    <details><summary>Failure regions</summary><ul>${failedRegions || "<li>None</li>"}</ul></details>
  </article>`;
}

function sectionHtml(title, items, mediaById, htmlFile) {
  const content = items.map(
    (item) => cardHtml(item, mediaById.get(item.id), htmlFile),
  ).join("");
  return `<section><h2>${escapeHtml(title)}</h2>${content || "<p>None.</p>"}</section>`;
}

function formatRate(count, total) {
  if (total === 0) return "0%";
  return `${Number(((count / total) * 100).toFixed(1))}%`;
}

function reviewHtml({ state, accepted, audit, quarantined, mediaById, htmlFile }) {
  const total = state.items?.length ?? 0;
  const failed = (state.items ?? []).filter(
    ({ status }) => status === "failed-infrastructure",
  ).length;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(state.batchSlug)} image batch review</title>
  <style>
    :root { color-scheme: light; font: 16px/1.45 system-ui, sans-serif; background: #f4f1eb; color: #27231f; }
    body { margin: auto; max-width: 1100px; padding: 2rem; }
    section { margin-block: 2.5rem; }
    article { background: white; border: 1px solid #d8d0c5; border-radius: 10px; margin-block: 1rem; padding: 1rem; }
    .media { display: flex; flex-wrap: wrap; gap: .75rem; align-items: start; }
    img { background: #f4f1eb; border: 1px solid #ded7cd; height: auto; max-height: 240px; max-width: 240px; object-fit: contain; }
    li img { display: block; margin-top: .4rem; max-height: 120px; max-width: 120px; }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(state.batchSlug)} image batch review</h1>
    <p>State updated ${escapeHtml(state.updatedAt ?? "unknown")}.</p>
    <ul>
      <li>Accepted: ${accepted.length} · Acceptance rate: ${formatRate(accepted.length, total)}</li>
      <li>Quarantined: ${quarantined.length} · Quarantine rate: ${formatRate(quarantined.length, total)}</li>
      <li>Failed infrastructure: ${failed} · Infrastructure-failure rate: ${formatRate(failed, total)}</li>
    </ul>
  </header>
  ${sectionHtml("Accepted", accepted, mediaById, htmlFile)}
  ${sectionHtml("Audit sample", audit, mediaById, htmlFile)}
  ${sectionHtml("Quarantine", quarantined, mediaById, htmlFile)}
</body>
</html>
`;
}

function markdownReport(report) {
  const rows = report.items.map((item) =>
    `| ${escapeMarkdown(item.name)} | ${escapeMarkdown(item.status)}`
    + ` | ${escapeMarkdown(item.reason)}`
    + ` | ${escapeMarkdown(item.failedRegions.join(", ") || "—")}`
    + ` | ${item.generationAttempts} | ${item.deterministicAttempts.total}`
    + ` | ${item.retries} |`).join("\n");
  const counts = report.counts;
  return `# ${escapeMarkdown(report.batchSlug)} image batch report

## Counts

- Accepted: ${counts.accepted}
- Quarantined: ${counts.quarantined}
- Failed infrastructure: ${counts["failed-infrastructure"]}
- Retries: ${counts.retries}
- Generation attempts: ${counts.generationAttempts}
- Deterministic attempts: ${counts.deterministicAttempts.total} (${counts.deterministicAttempts.cleanup} cleanup, ${counts.deterministicAttempts.placement} placement)

## Items

| Item | Status | Reason | Failure regions | Generation attempts | Deterministic attempts | Retries |
| --- | --- | --- | --- | ---: | ---: | ---: |
${rows || "| — | — | — | — | 0 | 0 | 0 |"}
`;
}

async function mediaForItem({
  item,
  workspacePath,
  thumbnailDirectory,
  contactSheetDirectory,
  warnings,
}) {
  const slug = safeSlug(item);
  const sources = [];
  for (const [index, source] of (item.sources ?? []).entries()) {
    const output = path.join(
      thumbnailDirectory,
      `${slug}-source-${String(index + 1).padStart(3, "0")}.jpg`,
    );
    const result = await writeThumbnail(source.path, output);
    if (result.missing) {
      warnings.push({
        itemId: item.id,
        kind: "source",
        path: source.path,
        reason: "image-unavailable",
      });
    } else {
      sources.push(output);
    }
  }

  const attempts = [];
  const links = new Set();
  for (const [index, attempt] of (item.attempts ?? []).entries()) {
    const output = path.join(
      thumbnailDirectory,
      `${slug}-attempt-${String(index + 1).padStart(3, "0")}.jpg`,
    );
    const result = await writeThumbnail(attempt.path, output);
    if (result.missing) {
      warnings.push({
        itemId: item.id,
        kind: "attempt",
        path: attempt.path,
        reason: "image-unavailable",
      });
      attempts.push({ attempt, thumbnail: null });
    } else {
      attempts.push({ attempt, thumbnail: output });
    }
    try {
      const canonical = await realpath(attempt.path);
      if (isContained(workspacePath, canonical)) links.add(attempt.path);
    } catch {
      // The warning above is sufficient for an unavailable optional attempt.
    }
  }

  let preview = null;
  const originalPreview = previewPath(item);
  if (originalPreview) {
    const output = path.join(thumbnailDirectory, `${slug}-preview.jpg`);
    const result = await writeThumbnail(originalPreview, output);
    if (result.missing) {
      warnings.push({
        itemId: item.id,
        kind: "preview",
        path: originalPreview,
        reason: "image-unavailable",
      });
    } else {
      try {
        const canonical = await realpath(originalPreview);
        if (isContained(workspacePath, canonical)) {
          preview = { original: originalPreview, thumbnail: output };
        }
      } catch {
        // writeThumbnail already produced the availability warning if needed.
      }
    }
  }

  const contactSheetPath = path.join(contactSheetDirectory, `${slug}.jpg`);
  const sheet = await writeContactSheet({
    sources,
    attempts: attempts.map(({ thumbnail }) => thumbnail).filter(Boolean),
    preview: preview?.thumbnail ?? null,
    output: contactSheetPath,
  });
  for (const missing of sheet.missing) {
    warnings.push({
      itemId: item.id,
      kind: "contact-sheet",
      path: missing,
      reason: "image-unavailable",
    });
  }

  return {
    sources,
    attempts,
    preview,
    contactSheet: sheet.output,
    links,
  };
}

export async function writeBatchReports({ state, workspaceDir }) {
  const workspacePath = await realpath(workspaceDir);
  if (state.workspacePath) {
    const stateWorkspace = await realpath(state.workspacePath);
    if (stateWorkspace !== workspacePath) {
      throw new Error("Report workspace does not match batch state workspace");
    }
  }
  const reportDirectory = await ensureManagedDirectory(
    workspacePath,
    ["reports"],
  );
  const auditDirectory = await ensureManagedDirectory(
    workspacePath,
    ["audit"],
  );
  const thumbnailDirectory = await ensureManagedDirectory(
    workspacePath,
    ["audit", "thumbnails"],
  );
  const contactSheetDirectory = await ensureManagedDirectory(
    workspacePath,
    ["audit", "contact-sheets"],
  );

  const items = [...(state.items ?? [])].sort(
    (left, right) => String(left.id).localeCompare(String(right.id)),
  );
  const accepted = items.filter(({ status }) => status === "accepted");
  const quarantined = items.filter(({ status }) => status === "quarantined");
  const audit = selectAuditSample(accepted, state.policy?.auditRate ?? 0.1);
  const auditIds = audit.map(({ id }) => id);
  const counts = reportCounts(items);
  const paths = {
    json: path.join(reportDirectory, "batch-report.json"),
    markdown: path.join(reportDirectory, "batch-report.md"),
    auditSample: path.join(auditDirectory, "sample.json"),
    reviewHtml: path.join(auditDirectory, "review.html"),
  };
  const warnings = [];
  const visible = new Map(
    [...accepted, ...quarantined].map((item) => [item.id, item]),
  );
  const mediaById = new Map();
  for (const item of visible.values()) {
    mediaById.set(item.id, await mediaForItem({
      item,
      workspacePath,
      thumbnailDirectory,
      contactSheetDirectory,
      warnings,
    }));
  }

  const report = {
    version: 1,
    batchSlug: state.batchSlug,
    stateUpdatedAt: state.updatedAt ?? null,
    counts,
    auditIds,
    items: items.map(reportItem),
    infrastructureErrors: state.infrastructureErrors ?? [],
    imageWarnings: warnings,
  };
  const sample = {
    rate: state.policy?.auditRate ?? 0.1,
    count: auditIds.length,
    ids: auditIds,
  };
  await Promise.all([
    atomicWriteText(paths.json, `${JSON.stringify(report, null, 2)}\n`),
    atomicWriteText(paths.markdown, markdownReport(report)),
    atomicWriteText(
      paths.auditSample,
      `${JSON.stringify(sample, null, 2)}\n`,
    ),
    atomicWriteText(paths.reviewHtml, reviewHtml({
      state,
      accepted,
      audit,
      quarantined,
      mediaById,
      htmlFile: paths.reviewHtml,
    })),
  ]);

  return {
    reviewHtml: paths.reviewHtml,
    auditItemIds: auditIds,
    paths,
    counts,
    auditIds,
    warnings,
  };
}
