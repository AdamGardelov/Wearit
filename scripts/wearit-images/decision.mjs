export const CRITICAL_REGIONS = Object.freeze([
  "sourceFidelity",
  "collar",
  "leftShoulder",
  "rightShoulder",
  "leftSleeve",
  "rightSleeve",
  "leftCuff",
  "rightCuff",
  "torso",
  "hem",
  "visibleMannequin",
  "artifacts",
]);

const REGION_SET = new Set(CRITICAL_REGIONS);
const REVIEW_STATUSES = new Set(["pass", "fail", "uncertain"]);
const CLEANUP_FAILURE_KINDS = new Set([
  "chroma-residue",
  "detached-components",
]);
const CORRECTIONS = Object.freeze({
  sourceFidelity: {
    target: "source-fidelity",
    preserve: [],
    consumesGenerationAttempt: true,
  },
  leftShoulder: {
    target: "left-shoulder",
    preserve: ["product-image"],
    consumesGenerationAttempt: true,
  },
  rightShoulder: {
    target: "right-shoulder",
    preserve: ["product-image"],
    consumesGenerationAttempt: true,
  },
  leftSleeve: {
    target: "left-sleeve",
    preserve: ["product-image"],
    consumesGenerationAttempt: true,
  },
  rightSleeve: {
    target: "right-sleeve",
    preserve: ["product-image"],
    consumesGenerationAttempt: true,
  },
  leftCuff: {
    target: "left-cuff",
    preserve: ["product-image"],
    consumesGenerationAttempt: true,
  },
  rightCuff: {
    target: "right-cuff",
    preserve: ["product-image"],
    consumesGenerationAttempt: true,
  },
  torso: {
    target: "torso-hem",
    preserve: ["product-image"],
    consumesGenerationAttempt: true,
  },
  hem: {
    target: "torso-hem",
    preserve: ["product-image"],
    consumesGenerationAttempt: true,
  },
});

function isPlainObject(value) {
  return (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
  );
}

function invalidReview(reason) {
  throw new Error(`Invalid visual review: ${reason}`);
}

function copyCorrection(correction) {
  return {
    target: correction.target,
    preserve: [...correction.preserve],
    consumesGenerationAttempt: correction.consumesGenerationAttempt,
  };
}

function orderedRegions(regions) {
  const unique = new Set(regions);
  return CRITICAL_REGIONS.filter((region) => unique.has(region));
}

function itemIdsMustMatch(structural, placement, review) {
  const itemIds = [structural?.itemId, placement?.itemId, review?.itemId]
    .filter((itemId) => itemId !== undefined);
  if (
    itemIds.some((itemId) =>
      typeof itemId !== "string" || itemId.trim().length === 0)
    || new Set(itemIds).size > 1
  ) {
    throw new Error("Decision input itemId values must match");
  }
}

function infrastructureError(structural, placement) {
  return structural?.infrastructureError ?? placement?.infrastructureError;
}

function infrastructureDecision(error) {
  const name = typeof error?.name === "string" && error.name.trim()
    ? error.name
    : "InfrastructureError";
  const message = typeof error?.message === "string" && error.message.trim()
    ? error.message
    : "Infrastructure failure";
  return {
    decision: "stop",
    reason: "infrastructure-error",
    error: { name, message },
  };
}

function cleanupCorrection() {
  return {
    target: "deterministic-cleanup",
    preserve: ["product-image", "wear-layer"],
    consumesGenerationAttempt: false,
  };
}

export function validateVisualReview(review) {
  if (!isPlainObject(review) || !isPlainObject(review.regions)) {
    invalidReview("review and regions must be objects");
  }
  if (
    review.schemaVersion !== undefined
    && review.schemaVersion !== 1
  ) {
    invalidReview("schemaVersion must be 1");
  }
  if (
    review.itemId !== undefined
    && (
      typeof review.itemId !== "string"
      || review.itemId.trim().length === 0
    )
  ) {
    invalidReview("itemId must be a non-empty string");
  }

  const regionNames = Object.keys(review.regions);
  const missing = CRITICAL_REGIONS.filter((name) =>
    !Object.hasOwn(review.regions, name));
  const extra = regionNames.filter((name) => !REGION_SET.has(name));
  if (missing.length > 0 || extra.length > 0) {
    invalidReview(
      `regions must match the critical-region contract`
      + ` (missing: ${missing.join(",") || "none"};`
      + ` extra: ${extra.join(",") || "none"})`,
    );
  }

  for (const name of CRITICAL_REGIONS) {
    const result = review.regions[name];
    if (!isPlainObject(result)) {
      invalidReview(`${name} must be an object`);
    }
    if (!REVIEW_STATUSES.has(result.status)) {
      invalidReview(`${name}.status must be pass, fail, or uncertain`);
    }
    if (
      typeof result.confidence !== "number"
      || !Number.isFinite(result.confidence)
      || result.confidence < 0
      || result.confidence > 1
    ) {
      invalidReview(`${name}.confidence must be between 0 and 1`);
    }
    if (
      typeof result.reason !== "string"
      || result.reason.trim().length === 0
    ) {
      invalidReview(`${name}.reason must be a non-empty string`);
    }
  }

  return review;
}

export function classifyCorrection(failedRegions) {
  if (
    !Array.isArray(failedRegions)
    || failedRegions.length === 0
    || failedRegions.some((region) => !REGION_SET.has(region))
  ) {
    return null;
  }

  const corrections = orderedRegions(failedRegions)
    .map((region) => CORRECTIONS[region]);
  if (
    corrections.some((correction) => correction === undefined)
    || new Set(corrections.map((correction) => correction.target)).size !== 1
  ) {
    return null;
  }

  return copyCorrection(corrections[0]);
}

export function decideItem({
  structural,
  placement,
  review,
  deterministicAttempts = { cleanup: 0, placement: 0 },
  generationAttempts,
  maxGenerationAttempts = 3,
  minimumConfidence = 0.9,
}) {
  if (
    !Number.isInteger(generationAttempts)
    || generationAttempts < 0
    || !Number.isInteger(maxGenerationAttempts)
    || maxGenerationAttempts < 1
  ) {
    throw new Error("Generation attempts must be non-negative integers");
  }
  if (
    !isPlainObject(deterministicAttempts)
    || !Number.isInteger(deterministicAttempts.cleanup)
    || deterministicAttempts.cleanup < 0
    || !Number.isInteger(deterministicAttempts.placement)
    || deterministicAttempts.placement < 0
  ) {
    throw new Error(
      "Deterministic attempts must contain non-negative integers",
    );
  }
  if (
    typeof minimumConfidence !== "number"
    || !Number.isFinite(minimumConfidence)
    || minimumConfidence < 0
    || minimumConfidence > 1
  ) {
    throw new Error("Minimum confidence must be between 0 and 1");
  }
  if (!isPlainObject(structural) || typeof structural.pass !== "boolean") {
    throw new Error("Structural result must contain a boolean pass");
  }

  itemIdsMustMatch(structural, placement, review);
  const infrastructure = infrastructureError(structural, placement);
  if (infrastructure) return infrastructureDecision(infrastructure);

  if (
    !Array.isArray(structural.failures)
    || structural.failures.some((failure) =>
      typeof failure !== "string" || failure.length === 0)
  ) {
    throw new Error("Structural result must contain failure names");
  }
  if (!structural.pass) {
    if (
      structural.failures.length > 0
      && structural.failures.every((failure) =>
        CLEANUP_FAILURE_KINDS.has(failure))
    ) {
      if (deterministicAttempts.cleanup >= 1) {
        return {
          decision: "quarantine",
          reason: "deterministic-no-progress",
          deterministicStage: "cleanup",
          structuralFailures: [...structural.failures],
        };
      }
      return {
        decision: "retry",
        reason: "repairable-structural-failure",
        correction: cleanupCorrection(),
      };
    }
    return {
      decision: "quarantine",
      reason: "irreparable-structural-failure",
    };
  }

  if (
    !isPlainObject(placement)
    || !isPlainObject(placement.metrics)
    || !Array.isArray(placement.metrics.uncoveredCriticalRegions)
    || !Array.isArray(placement.metrics.forbiddenRegionViolations)
    || typeof placement.metrics.clippingFraction !== "number"
    || !Number.isFinite(placement.metrics.clippingFraction)
    || placement.metrics.clippingFraction < 0
  ) {
    throw new Error(
      "Placement result must contain valid constraint metrics",
    );
  }
  const placementFailures = placement.metrics.uncoveredCriticalRegions;
  if (placementFailures.some((region) => !REGION_SET.has(region))) {
    throw new Error("Placement contains an unknown critical region");
  }
  if (placement.metrics.forbiddenRegionViolations.some((region) =>
    typeof region !== "string" || region.length === 0)) {
    throw new Error("Placement contains an invalid forbidden region");
  }

  validateVisualReview(review);
  const globalPlacementFailure = (
    placement.metrics.forbiddenRegionViolations.length > 0
    || placement.metrics.clippingFraction > 0
  );
  if (globalPlacementFailure) {
    const failures = {
      forbiddenRegionViolations: [
        ...placement.metrics.forbiddenRegionViolations,
      ],
      clippingFraction: placement.metrics.clippingFraction,
    };
    if (deterministicAttempts.placement >= 1) {
      return {
        decision: "quarantine",
        reason: "deterministic-no-progress",
        deterministicStage: "placement",
        placementFailures: failures,
      };
    }
    return {
      decision: "retry",
      reason: "placement-constraint-violation",
      correction: {
        target: "placement",
        preserve: ["product-image", "wear-layer"],
        consumesGenerationAttempt: false,
      },
    };
  }
  const reviewFailures = CRITICAL_REGIONS.filter((name) => {
    const result = review.regions[name];
    return (
      result.status !== "pass"
      || result.confidence < minimumConfidence
    );
  });
  const failedRegions = orderedRegions([
    ...placementFailures,
    ...reviewFailures,
  ]);

  if (failedRegions.length === 0) {
    return {
      decision: "accept",
      reason: "all-critical-regions-pass",
    };
  }

  const correction = classifyCorrection(failedRegions);
  if (!correction) {
    const hasKnownCorrection = failedRegions.some((region) =>
      CORRECTIONS[region] !== undefined);
    return {
      decision: "quarantine",
      reason: hasKnownCorrection
        ? "conflicting-corrections"
        : "unsupported-correction",
      failedRegions,
    };
  }
  if (
    correction.consumesGenerationAttempt
    && generationAttempts >= maxGenerationAttempts
  ) {
    return {
      decision: "quarantine",
      reason: "generation-budget-exhausted",
      failedRegions,
    };
  }

  return {
    decision: "retry",
    reason: correction.consumesGenerationAttempt
      ? "targeted-generation-correction"
      : "targeted-cleanup-correction",
    correction,
  };
}
