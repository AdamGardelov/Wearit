import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const EPSILON = 1e-9;
const PAIRS = [
  ["leftShoulder", "rightShoulder"],
  ["leftSleeve", "rightSleeve"],
  ["leftCuff", "rightCuff"],
];
let sharedScaleCache = {
  layerKey: undefined,
  scales: new Map(),
};

function placementKey({ anchorX, anchorY, scale, rotationDegrees }) {
  return [anchorX, anchorY, scale, rotationDegrees]
    .map((value) => value.toFixed(6))
    .join(":");
}

function numericGrid(min, max, step) {
  const precision = 1_000_000;
  const start = Math.round(min * precision);
  const end = Math.round(max * precision);
  const increment = Math.round(step * precision);
  const values = [];
  for (let value = start; value <= end; value += increment) {
    values.push(value / precision);
  }
  return values;
}

function boundedNeighborhood(center, bounds) {
  const min = Math.max(bounds.min, center - bounds.coarseStep);
  const max = Math.min(bounds.max, center + bounds.coarseStep);
  return numericGrid(min, max, bounds.fineStep);
}

function compareCandidates(left, right) {
  const scoreDifference = right.score - left.score;
  if (Math.abs(scoreDifference) > EPSILON) return scoreDifference;
  const leftTuple = [
    left.placement.anchorX,
    left.placement.anchorY,
    left.placement.scale,
    left.placement.rotationDegrees,
  ];
  const rightTuple = [
    right.placement.anchorX,
    right.placement.anchorY,
    right.placement.scale,
    right.placement.rotationDegrees,
  ];
  for (let index = 0; index < leftTuple.length; index += 1) {
    if (leftTuple[index] !== rightTuple[index]) {
      return leftTuple[index] - rightTuple[index];
    }
  }
  return 0;
}

function alphaCoverage(alpha, width, region) {
  let total = 0;
  const maxX = Math.min(width, region.x + region.width);
  const height = Math.floor(alpha.length / width);
  const maxY = Math.min(height, region.y + region.height);
  for (let y = Math.max(0, region.y); y < maxY; y += 1) {
    const row = y * width;
    for (let x = Math.max(0, region.x); x < maxX; x += 1) {
      total += alpha[row + x];
    }
  }
  return total / (255 * region.width * region.height);
}

function scoreCoverages({ criticalCoverage, forbiddenCoverage, profile }) {
  const uncoveredCriticalRegions = profile.criticalRegions
    .filter((region) =>
      criticalCoverage[region.name] + EPSILON < region.minCoverage)
    .map((region) => region.name);
  const forbiddenRegionViolations = profile.forbiddenRegions
    .filter((region) =>
      forbiddenCoverage[region.name] - EPSILON > region.maxCoverage)
    .map((region) => region.name);
  const requiredCoverage = Object.values(criticalCoverage)
    .reduce((sum, coverage) => sum + coverage, 0);
  const coverageShortfall = profile.criticalRegions.reduce(
    (sum, region) =>
      sum + Math.max(0, region.minCoverage - criticalCoverage[region.name]),
    0,
  );
  const forbiddenTotal = Object.values(forbiddenCoverage)
    .reduce((sum, coverage) => sum + coverage, 0);
  const asymmetry = PAIRS.reduce(
    (sum, [left, right]) =>
      sum + Math.abs(criticalCoverage[left] - criticalCoverage[right]),
    0,
  ) / PAIRS.length;
  const weights = profile.scoring;
  const score = (
    requiredCoverage * weights.requiredCoverageWeight
    - coverageShortfall * weights.uncoveredCriticalPenalty
    - forbiddenTotal * weights.forbiddenCoveragePenalty
    - asymmetry * weights.asymmetryPenalty
  );

  return {
    score,
    metrics: {
      criticalCoverage,
      forbiddenCoverage,
      uncoveredCriticalRegions,
      forbiddenRegionViolations,
      asymmetry,
    },
  };
}

export async function transformLayer({ wearLayer, placement }) {
  const source = sharp(path.resolve(wearLayer)).ensureAlpha();
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Could not read wear layer dimensions");
  }
  const width = metadata.width;
  const height = metadata.height;
  const renderedWidth = Math.max(1, Math.round(width * placement.scale));
  const { data, info } = await source
    .resize({ width: renderedWidth })
    .rotate(placement.rotationDegrees, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const left = Math.round(placement.anchorX * width - info.width / 2) || 0;
  const top = Math.round(placement.anchorY * height - info.height / 2) || 0;
  const compositeLeft = Math.max(0, left);
  const compositeTop = Math.max(0, top);
  const compositeRight = Math.min(width, left + info.width);
  const compositeBottom = Math.min(height, top + info.height);
  const intersectionWidth = Math.max(0, compositeRight - compositeLeft);
  const intersectionHeight = Math.max(0, compositeBottom - compositeTop);
  const alpha = Buffer.alloc(width * height);
  const rgba = Buffer.alloc(width * height * 4);
  let sourceAlpha = 0;
  let visibleAlpha = 0;

  for (let sourceY = 0; sourceY < info.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < info.width; sourceX += 1) {
      sourceAlpha += data[
        (sourceY * info.width + sourceX) * info.channels + 3
      ];
    }
  }
  for (let y = 0; y < intersectionHeight; y += 1) {
    const sourceY = compositeTop - top + y;
    const targetY = compositeTop + y;
    for (let x = 0; x < intersectionWidth; x += 1) {
      const sourceX = compositeLeft - left + x;
      const targetX = compositeLeft + x;
      const sourceOffset = (
        sourceY * info.width + sourceX
      ) * info.channels;
      const targetPixel = targetY * width + targetX;
      const targetOffset = targetPixel * 4;
      data.copy(
        rgba,
        targetOffset,
        sourceOffset,
        sourceOffset + Math.min(4, info.channels),
      );
      const value = data[sourceOffset + 3];
      alpha[targetPixel] = value;
      visibleAlpha += value;
    }
  }

  return {
    alpha,
    rgba,
    width,
    height,
    left,
    top,
    garmentWidth: info.width,
    garmentHeight: info.height,
    clipped: (
      intersectionWidth !== info.width || intersectionHeight !== info.height
    ),
    clippingFraction: sourceAlpha === 0
      ? 0
      : (sourceAlpha - visibleAlpha) / sourceAlpha,
  };
}

export function scoreJacketCandidate({ alpha, width, height, profile }) {
  if (alpha.length !== width * height) {
    throw new Error("Candidate alpha must contain one byte per canvas pixel");
  }
  const criticalCoverage = Object.fromEntries(
    profile.criticalRegions.map((region) => [
      region.name,
      alphaCoverage(alpha, width, region),
    ]),
  );
  const forbiddenCoverage = Object.fromEntries(
    profile.forbiddenRegions.map((region) => [
      region.name,
      alphaCoverage(alpha, width, region),
    ]),
  );
  return scoreCoverages({ criticalCoverage, forbiddenCoverage, profile });
}

function integralAlpha(data, width, height) {
  const integral = new Uint32Array((width + 1) * (height + 1));
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      const value = data[y * width + x];
      row += value;
      total += value;
      integral[(y + 1) * (width + 1) + x + 1] = (
        integral[y * (width + 1) + x + 1] + row
      );
    }
  }
  return { integral, total };
}

function rectangleSum(scaled, x, y, width, height) {
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(scaled.width, x + width);
  const bottom = Math.min(scaled.height, y + height);
  if (right <= left || bottom <= top) return 0;
  const stride = scaled.width + 1;
  return (
    scaled.integral[bottom * stride + right]
    - scaled.integral[top * stride + right]
    - scaled.integral[bottom * stride + left]
    + scaled.integral[top * stride + left]
  );
}

function coverageFromScaled(scaled, placement, region, canvas) {
  const left = Math.round(
    placement.anchorX * canvas.width - scaled.width / 2,
  ) || 0;
  const top = Math.round(
    placement.anchorY * canvas.height - scaled.height / 2,
  ) || 0;
  return rectangleSum(
    scaled,
    region.x - left,
    region.y - top,
    region.width,
    region.height,
  ) / (255 * region.width * region.height);
}

function clippingFraction(scaled, placement, canvas) {
  if (scaled.total === 0) return 0;
  const left = Math.round(
    placement.anchorX * canvas.width - scaled.width / 2,
  ) || 0;
  const top = Math.round(
    placement.anchorY * canvas.height - scaled.height / 2,
  ) || 0;
  const visible = rectangleSum(
    scaled,
    -left,
    -top,
    canvas.width,
    canvas.height,
  );
  return (scaled.total - visible) / scaled.total;
}

async function prepareScale(wearLayer, scale, canvas) {
  const renderedWidth = Math.max(1, Math.round(canvas.width * scale));
  const { data, info } = await sharp(wearLayer)
    .ensureAlpha()
    .resize({ width: renderedWidth })
    .extractChannel("alpha")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const summed = integralAlpha(data, info.width, info.height);
  return {
    width: info.width,
    height: info.height,
    ...summed,
  };
}

async function outputMustNotExist(file) {
  try {
    await lstat(file);
    throw new Error(`Preview output already exists: ${file}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function writePreview({ mannequin, candidate, wearLayer, output }) {
  const base = sharp(mannequin);
  const { width, height } = await base.metadata();
  const renderedWidth = Math.max(
    1,
    Math.round(width * candidate.placement.scale),
  );
  const { data, info } = await sharp(wearLayer)
    .resize({ width: renderedWidth })
    .rotate(candidate.placement.rotationDegrees, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.round(
    candidate.placement.anchorX * width - info.width / 2,
  ) || 0;
  const top = Math.round(
    candidate.placement.anchorY * height - info.height / 2,
  ) || 0;
  const compositeLeft = Math.max(0, left);
  const compositeTop = Math.max(0, top);
  const compositeRight = Math.min(width, left + info.width);
  const compositeBottom = Math.min(height, top + info.height);
  const crop = {
    left: compositeLeft - left,
    top: compositeTop - top,
    width: compositeRight - compositeLeft,
    height: compositeBottom - compositeTop,
  };
  const visible = (
    crop.left !== 0
    || crop.top !== 0
    || crop.width !== info.width
    || crop.height !== info.height
  )
    ? await sharp(data).extract(crop).png().toBuffer()
    : data;
  const temporary = path.join(
    path.dirname(output),
    `.${path.basename(output)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await base
      .composite([{
        input: visible,
        left: compositeLeft,
        top: compositeTop,
      }])
      .png()
      .toFile(temporary);
    await link(temporary, output);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Preview output already exists: ${output}`);
    }
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function optimizeJacketPlacement({
  wearLayer,
  mannequin,
  profile,
  outputDir,
}) {
  const resolvedLayer = path.resolve(wearLayer);
  const resolvedMannequin = path.resolve(mannequin);
  const resolvedOutput = path.resolve(outputDir);
  const [layerMetadata, mannequinMetadata] = await Promise.all([
    sharp(resolvedLayer).metadata(),
    sharp(resolvedMannequin).metadata(),
  ]);
  for (const [label, metadata] of [
    ["Wear layer", layerMetadata],
    ["Mannequin", mannequinMetadata],
  ]) {
    if (
      metadata.width !== profile.canvas.width
      || metadata.height !== profile.canvas.height
    ) {
      throw new Error(
        `${label} must be ${profile.canvas.width}x${profile.canvas.height}`,
      );
    }
  }

  const previewCount = profile.search.previewCount;
  await mkdir(resolvedOutput, { recursive: true });
  const previewPaths = Array.from(
    { length: previewCount },
    (_, index) => path.join(resolvedOutput, `candidate-${index + 1}.png`),
  );
  await Promise.all(previewPaths.map(outputMustNotExist));

  const layerStat = await stat(resolvedLayer);
  const layerKey = [
    resolvedLayer,
    layerStat.size,
    layerStat.mtimeMs,
    profile.canvas.width,
    profile.canvas.height,
  ].join(":");
  if (sharedScaleCache.layerKey !== layerKey) {
    sharedScaleCache = { layerKey, scales: new Map() };
  }
  const scaleCache = sharedScaleCache.scales;
  const coarseScales = numericGrid(
    profile.search.scale.min,
    profile.search.scale.max,
    profile.search.scale.coarseStep,
  );
  await Promise.all(coarseScales.map(async (scale) => {
    const key = scale.toFixed(6);
    if (!scaleCache.has(key)) {
      scaleCache.set(
        key,
        await prepareScale(resolvedLayer, scale, profile.canvas),
      );
    }
  }));

  const evaluated = new Map();
  const evaluate = (placement) => {
    const key = placementKey(placement);
    if (evaluated.has(key)) return evaluated.get(key);
    const scaled = scaleCache.get(placement.scale.toFixed(6));
    const criticalCoverage = Object.fromEntries(
      profile.criticalRegions.map((region) => [
        region.name,
        coverageFromScaled(scaled, placement, region, profile.canvas),
      ]),
    );
    const forbiddenCoverage = Object.fromEntries(
      profile.forbiddenRegions.map((region) => [
        region.name,
        coverageFromScaled(scaled, placement, region, profile.canvas),
      ]),
    );
    const base = scoreCoverages({
      criticalCoverage,
      forbiddenCoverage,
      profile,
    });
    const clipped = clippingFraction(scaled, placement, profile.canvas);
    const anchorNeutralDistance = (
      Math.abs(placement.anchorX - 0.5)
      / (profile.search.anchorX.max - profile.search.anchorX.min)
      + Math.abs(placement.anchorY - 0.5)
      / (profile.search.anchorY.max - profile.search.anchorY.min)
    );
    const scaleNeutralDistance = (
      Math.abs(placement.scale - 1)
      / (profile.search.scale.max - profile.search.scale.min)
    );
    const neutralDistance = anchorNeutralDistance + scaleNeutralDistance;
    const score = (
      base.score
      - clipped * profile.scoring.clippingPenalty
      - anchorNeutralDistance * profile.scoring.neutralDistancePenalty
      - scaleNeutralDistance * profile.scoring.scaleNeutralDistancePenalty
    );
    const candidate = {
      placement,
      score: Number(score.toFixed(12)),
      metrics: {
        ...base.metrics,
        clippingFraction: clipped,
        neutralDistance,
        anchorNeutralDistance,
        scaleNeutralDistance,
      },
    };
    evaluated.set(key, candidate);
    return candidate;
  };

  const coarse = [];
  for (const anchorX of numericGrid(
    profile.search.anchorX.min,
    profile.search.anchorX.max,
    profile.search.anchorX.coarseStep,
  )) {
    for (const anchorY of numericGrid(
      profile.search.anchorY.min,
      profile.search.anchorY.max,
      profile.search.anchorY.coarseStep,
    )) {
      for (const scale of coarseScales) {
        for (const rotationDegrees of profile.search.rotationDegrees) {
          coarse.push(evaluate({
            anchorX,
            anchorY,
            scale,
            rotationDegrees,
          }));
        }
      }
    }
  }

  const coarseBest = coarse
    .sort(compareCandidates)
    .slice(0, profile.search.keepBest);
  const fineScales = new Set(
    coarseBest.flatMap((candidate) => boundedNeighborhood(
      candidate.placement.scale,
      profile.search.scale,
    )),
  );
  await Promise.all([...fineScales].map(async (scale) => {
    const key = scale.toFixed(6);
    if (!scaleCache.has(key)) {
      scaleCache.set(
        key,
        await prepareScale(resolvedLayer, scale, profile.canvas),
      );
    }
  }));
  for (const candidate of coarseBest) {
    for (const anchorX of boundedNeighborhood(
      candidate.placement.anchorX,
      profile.search.anchorX,
    )) {
      for (const anchorY of boundedNeighborhood(
        candidate.placement.anchorY,
        profile.search.anchorY,
      )) {
        for (const scale of boundedNeighborhood(
          candidate.placement.scale,
          profile.search.scale,
        )) {
          for (const rotationDegrees of profile.search.rotationDegrees) {
            evaluate({ anchorX, anchorY, scale, rotationDegrees });
          }
        }
      }
    }
  }

  const candidates = [...evaluated.values()]
    .sort(compareCandidates)
    .slice(0, previewCount)
    .map((candidate, index) => ({
      ...candidate,
      previewPath: previewPaths[index],
    }));
  for (const candidate of candidates) {
    await writePreview({
      mannequin: resolvedMannequin,
      candidate,
      wearLayer: resolvedLayer,
      output: candidate.previewPath,
    });
  }

  return {
    placement: candidates[0].placement,
    score: candidates[0].score,
    metrics: candidates[0].metrics,
    candidates,
    evaluatedPlacements: [...evaluated.values()].map(
      ({ placement }) => placement,
    ),
  };
}
