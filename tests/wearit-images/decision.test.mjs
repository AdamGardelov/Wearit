import { describe, expect, it } from "vitest";
import {
  CRITICAL_REGIONS,
  classifyCorrection,
  decideItem,
  validateVisualReview,
} from "../../scripts/wearit-images/decision.mjs";

const EXPECTED_CRITICAL_REGIONS = [
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
];

function reviewWith(regionOverrides = {}, reviewOverrides = {}) {
  return {
    schemaVersion: 1,
    itemId: "item-1",
    regions: Object.fromEntries(
      EXPECTED_CRITICAL_REGIONS.map((name) => [
        name,
        {
          status: "pass",
          confidence: 0.96,
          reason: "clear",
          ...regionOverrides[name],
        },
      ]),
    ),
    ...reviewOverrides,
  };
}

function placementWith(metricOverrides = {}, placementOverrides = {}) {
  return {
    itemId: "item-1",
    metrics: {
      criticalCoverage: {},
      forbiddenCoverage: {},
      uncoveredCriticalRegions: [],
      forbiddenRegionViolations: [],
      asymmetry: 0,
      clippingFraction: 0,
      neutralDistance: 0,
      anchorNeutralDistance: 0,
      scaleNeutralDistance: 0,
      ...metricOverrides,
    },
    ...placementOverrides,
  };
}

function validInput(overrides = {}) {
  return {
    structural: { pass: true, failures: [] },
    placement: placementWith(),
    review: reviewWith(),
    deterministicAttempts: { cleanup: 0, placement: 0 },
    generationAttempts: 1,
    ...overrides,
  };
}

describe("visual review validation", () => {
  it("exports the exact ordered critical-region contract", () => {
    expect(CRITICAL_REGIONS).toEqual(EXPECTED_CRITICAL_REGIONS);
  });

  it.each([
    [
      "a missing region",
      () => {
        const review = reviewWith();
        delete review.regions.hem;
        return review;
      },
    ],
    [
      "an extra region",
      () => {
        const review = reviewWith();
        review.regions.pocket = {
          status: "pass",
          confidence: 0.99,
          reason: "clear",
        };
        return review;
      },
    ],
    [
      "an unsupported status",
      () => reviewWith({ collar: { status: "maybe" } }),
    ],
    [
      "a confidence below zero",
      () => reviewWith({ collar: { confidence: -0.01 } }),
    ],
    [
      "a confidence above one",
      () => reviewWith({ collar: { confidence: 1.01 } }),
    ],
    [
      "a non-numeric confidence",
      () => reviewWith({ collar: { confidence: "0.96" } }),
    ],
    [
      "an empty reason",
      () => reviewWith({ collar: { reason: "   " } }),
    ],
    [
      "a non-boolean applicability flag",
      () => reviewWith({ leftSleeve: { applicable: "no" } }),
    ],
    [
      "a mandatory region marked non-applicable",
      () => reviewWith({ torso: { applicable: false } }),
    ],
  ])("rejects %s", (_description, makeReview) => {
    expect(() => validateVisualReview(makeReview())).toThrow(
      /invalid visual review/i,
    );
  });

  it("rejects a review for a different item", () => {
    expect(() => decideItem(validInput({
      review: reviewWith({}, { itemId: "item-2" }),
    }))).toThrow(/itemId.*match/i);
  });

  it.each([
    { cleanup: -1, placement: 0 },
    { cleanup: 0.5, placement: 0 },
    { cleanup: 0, placement: -1 },
    { cleanup: 0, placement: 0.5 },
    { cleanup: 0 },
    null,
  ])("rejects invalid deterministic attempt state %#", (attempts) => {
    expect(() => decideItem(validInput({
      deterministicAttempts: attempts,
    }))).toThrow(/deterministic attempts.*non-negative integers/i);
  });

  it("defaults deterministic attempt counts to zero", () => {
    const input = validInput();
    delete input.deterministicAttempts;

    expect(decideItem(input)).toEqual({
      decision: "accept",
      reason: "all-critical-regions-pass",
    });
  });
});

describe("conservative item decisions", () => {
  it("accepts only when every critical region passes confidently", () => {
    expect(decideItem(validInput())).toEqual({
      decision: "accept",
      reason: "all-critical-regions-pass",
    });
  });

  it("retries a failed right cuff with a targeted wear-only correction", () => {
    expect(decideItem(validInput({
      review: reviewWith({
        rightCuff: {
          status: "fail",
          confidence: 0.99,
          reason: "mannequin wrist exposed",
        },
      }),
    }))).toEqual({
      decision: "retry",
      reason: "targeted-generation-correction",
      correction: {
        target: "right-cuff",
        preserve: ["product-image"],
        consumesGenerationAttempt: true,
      },
    });
  });

  it("retries a coherent arm-torso transparency defect", () => {
    const failure = {
      status: "fail",
      confidence: 0.99,
      reason: "opaque strip remains in the intended transparent gap",
    };
    expect(decideItem(validInput({
      review: reviewWith({
        leftSleeve: failure,
        rightSleeve: failure,
        torso: failure,
        visibleMannequin: failure,
        artifacts: failure,
      }),
      generationAttempts: 1,
    }))).toEqual({
      decision: "retry",
      reason: "targeted-generation-correction",
      correction: {
        target: "arm-torso-gaps",
        preserve: ["product-image"],
        consumesGenerationAttempt: true,
      },
    });
  });

  it("quarantines an arm-torso transparency defect at the generation limit", () => {
    const failure = {
      status: "fail",
      confidence: 0.99,
      reason: "opaque strip remains in the intended transparent gap",
    };
    expect(decideItem(validInput({
      review: reviewWith({
        leftSleeve: failure,
        rightSleeve: failure,
        torso: failure,
        visibleMannequin: failure,
        artifacts: failure,
      }),
      generationAttempts: 3,
    }))).toEqual({
      decision: "quarantine",
      reason: "generation-budget-exhausted",
      failedRegions: [
        "leftSleeve",
        "rightSleeve",
        "torso",
        "visibleMannequin",
        "artifacts",
      ],
    });
  });

  it("quarantines an uncertain region when the generation budget is exhausted", () => {
    expect(decideItem(validInput({
      review: reviewWith({
        rightCuff: {
          status: "uncertain",
          confidence: 0.8,
          reason: "edge unclear",
        },
      }),
      generationAttempts: 3,
    }))).toEqual({
      decision: "quarantine",
      reason: "generation-budget-exhausted",
      failedRegions: ["rightCuff"],
    });
  });

  it("does not let an aggregate score override one failed region", () => {
    expect(decideItem(validInput({
      review: reviewWith(
        {
          leftSleeve: {
            status: "fail",
            confidence: 0.99,
            reason: "mannequin arm visible",
          },
        },
        { aggregateScore: 0.999 },
      ),
    }))).toMatchObject({
      decision: "retry",
      correction: { target: "left-sleeve" },
    });
  });

  it("treats a low-confidence pass as blocking", () => {
    expect(decideItem(validInput({
      review: reviewWith({
        torso: {
          status: "pass",
          confidence: 0.89,
          reason: "probably aligned",
        },
      }),
    }))).toMatchObject({
      decision: "retry",
      correction: { target: "torso-hem" },
    });
  });

  it.each([
    ["chroma-residue", 1],
    ["chroma-residue", 2],
    ["detached-components", 1],
    ["detached-components", 2],
  ])(
    "maps inspector failure %s to first cleanup at generation %i",
    (failure, generationAttempts) => {
      expect(decideItem(validInput({
        structural: { pass: false, failures: [failure] },
        generationAttempts,
      }))).toEqual({
        decision: "retry",
        reason: "repairable-structural-failure",
        correction: {
          target: "deterministic-cleanup",
          preserve: ["product-image", "wear-layer"],
          consumesGenerationAttempt: false,
        },
      });
    },
  );

  it.each([1, 2])(
    "quarantines cleanup no-progress at generation %i",
    (generationAttempts) => {
      expect(decideItem(validInput({
        structural: { pass: false, failures: ["chroma-residue"] },
        deterministicAttempts: { cleanup: 1, placement: 0 },
        generationAttempts,
      }))).toEqual({
        decision: "quarantine",
        reason: "deterministic-no-progress",
        deterministicStage: "cleanup",
        structuralFailures: ["chroma-residue"],
      });
    },
  );

  it("quarantines an irreparable structural failure", () => {
    expect(decideItem(validInput({
      structural: { pass: false, failures: ["dimensions"] },
    }))).toEqual({
      decision: "quarantine",
      reason: "irreparable-structural-failure",
    });
  });

  it("does not hide an irreparable failure behind a cleanup failure", () => {
    expect(decideItem(validInput({
      structural: {
        pass: false,
        failures: ["chroma-residue", "dimensions"],
      },
    }))).toEqual({
      decision: "quarantine",
      reason: "irreparable-structural-failure",
    });
  });

  it("lets uncovered placement regions veto a passing visual review", () => {
    expect(decideItem(validInput({
      placement: placementWith({
        uncoveredCriticalRegions: ["rightShoulder"],
      }),
    }))).toEqual({
      decision: "retry",
      reason: "targeted-generation-correction",
      correction: {
        target: "right-shoulder",
        preserve: ["product-image"],
        consumesGenerationAttempt: true,
      },
    });
  });

  it("ignores placement coverage for explicitly non-applicable sleeve regions", () => {
    const absent = {
      applicable: false,
      status: "pass",
      confidence: 0.99,
      reason: "the source garment is intentionally sleeveless",
    };
    expect(decideItem(validInput({
      placement: placementWith({
        uncoveredCriticalRegions: [
          "leftSleeve",
          "rightSleeve",
          "leftCuff",
          "rightCuff",
        ],
      }),
      review: reviewWith({
        leftSleeve: absent,
        rightSleeve: absent,
        leftCuff: absent,
        rightCuff: absent,
      }),
    }))).toEqual({
      decision: "accept",
      reason: "all-critical-regions-pass",
    });
  });

  it("stops on infrastructure failures instead of quarantining the item", () => {
    expect(decideItem(validInput({
      structural: {
        pass: false,
        failures: [],
        infrastructureError: {
          name: "ReferenceUnavailable",
          message: "locked mannequin is missing",
        },
      },
    }))).toEqual({
      decision: "stop",
      reason: "infrastructure-error",
      error: {
        name: "ReferenceUnavailable",
        message: "locked mannequin is missing",
      },
    });
  });

  it("quarantines unknown or conflicting defects instead of retrying blindly", () => {
    expect(decideItem(validInput({
      review: reviewWith({
        collar: {
          status: "fail",
          confidence: 0.99,
          reason: "unsupported collar defect",
        },
      }),
    }))).toEqual({
      decision: "quarantine",
      reason: "unsupported-correction",
      failedRegions: ["collar"],
    });

    expect(decideItem(validInput({
      review: reviewWith({
        rightCuff: {
          status: "fail",
          confidence: 0.99,
          reason: "wrist exposed",
        },
        torso: {
          status: "fail",
          confidence: 0.99,
          reason: "too narrow",
        },
      }),
    }))).toEqual({
      decision: "quarantine",
      reason: "conflicting-corrections",
      failedRegions: ["rightCuff", "torso"],
    });
  });

  it("quarantines repeated visual artifact failures without cleanup retries", () => {
    const input = validInput({
      review: reviewWith({
        artifacts: {
          status: "fail",
          confidence: 0.99,
          reason: "residue remains after cleanup",
        },
      }),
    });
    const expected = {
      decision: "quarantine",
      reason: "unsupported-correction",
      failedRegions: ["artifacts"],
    };

    expect(decideItem(input)).toEqual(expected);
    expect(decideItem(input)).toEqual(expected);
  });

  it.each([
    {
      name: "forbidden-region coverage",
      metrics: { forbiddenRegionViolations: ["face"] },
    },
    {
      name: "any clipping",
      metrics: { clippingFraction: Number.EPSILON },
    },
  ])("retries placement for $name using actual Task 4 metrics", ({ metrics }) => {
    expect(decideItem(validInput({
      placement: placementWith(metrics),
    }))).toEqual({
      decision: "retry",
      reason: "placement-constraint-violation",
      correction: {
        target: "placement",
        preserve: ["product-image", "wear-layer"],
        consumesGenerationAttempt: false,
      },
    });
  });

  it("allows a first placement retry at generation two", () => {
    expect(decideItem(validInput({
      placement: placementWith({
        forbiddenRegionViolations: ["face"],
      }),
      generationAttempts: 2,
    }))).toEqual({
      decision: "retry",
      reason: "placement-constraint-violation",
      correction: {
        target: "placement",
        preserve: ["product-image", "wear-layer"],
        consumesGenerationAttempt: false,
      },
    });
  });

  it.each([1, 2])(
    "quarantines placement no-progress at generation %i",
    (generationAttempts) => {
      expect(decideItem(validInput({
        placement: placementWith({
          forbiddenRegionViolations: ["face"],
        }),
        deterministicAttempts: { cleanup: 0, placement: 1 },
        generationAttempts,
      }))).toEqual({
        decision: "quarantine",
        reason: "deterministic-no-progress",
        deterministicStage: "placement",
        placementFailures: {
          forbiddenRegionViolations: ["face"],
          clippingFraction: 0,
        },
      });
    },
  );

  it("allows candidate three one placement attempt, then quarantines no progress", () => {
    const input = validInput({
      placement: placementWith({
        forbiddenRegionViolations: ["lowerLegs"],
      }),
      generationAttempts: 3,
    });

    expect(decideItem(input)).toEqual({
      decision: "retry",
      reason: "placement-constraint-violation",
      correction: {
        target: "placement",
        preserve: ["product-image", "wear-layer"],
        consumesGenerationAttempt: false,
      },
    });

    expect(decideItem({
      ...input,
      deterministicAttempts: { cleanup: 0, placement: 1 },
    })).toEqual({
      decision: "quarantine",
      reason: "deterministic-no-progress",
      deterministicStage: "placement",
      placementFailures: {
        forbiddenRegionViolations: ["lowerLegs"],
        clippingFraction: 0,
      },
    });
  });

  it("never requests another generation at or above the attempt limit", () => {
    for (const generationAttempts of [3, 4]) {
      expect(decideItem(validInput({
        review: reviewWith({
          rightSleeve: {
            status: "fail",
            confidence: 0.99,
            reason: "arm visible",
          },
        }),
        generationAttempts,
      }))).toEqual({
        decision: "quarantine",
        reason: "generation-budget-exhausted",
        failedRegions: ["rightSleeve"],
      });
    }
  });
});

describe("correction classification", () => {
  it.each([
    [["leftSleeve"], "left-sleeve"],
    [["rightCuff"], "right-cuff"],
    [["leftShoulder"], "left-shoulder"],
    [["torso"], "torso-hem"],
    [["hem"], "torso-hem"],
    [["sourceFidelity"], "source-fidelity"],
  ])("maps %j to %s", (regions, target) => {
    expect(classifyCorrection(regions)).toMatchObject({ target });
  });

  it("does not authorize cleanup from a visual artifact classification", () => {
    expect(classifyCorrection(["artifacts"])).toBeNull();
  });
});
