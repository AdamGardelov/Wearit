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

function validInput(overrides = {}) {
  return {
    structural: { pass: true, itemId: "item-1" },
    placement: {
      itemId: "item-1",
      metrics: { uncoveredCriticalRegions: [] },
    },
    review: reviewWith(),
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

  it("maps repairable structural cleanup without consuming generation budget", () => {
    expect(decideItem(validInput({
      structural: {
        pass: false,
        itemId: "item-1",
        failure: {
          kind: "artifacts",
          repairable: true,
          reason: "detached pixel island",
        },
      },
      generationAttempts: 3,
    }))).toEqual({
      decision: "retry",
      reason: "repairable-structural-failure",
      correction: {
        target: "deterministic-cleanup",
        preserve: ["product-image", "wear-layer"],
        consumesGenerationAttempt: false,
      },
    });
  });

  it("quarantines an irreparable structural failure", () => {
    expect(decideItem(validInput({
      structural: {
        pass: false,
        itemId: "item-1",
        failure: {
          kind: "dimensions",
          repairable: false,
          reason: "wrong coordinate plane",
        },
      },
    }))).toEqual({
      decision: "quarantine",
      reason: "irreparable-structural-failure",
    });
  });

  it("lets uncovered placement regions veto a passing visual review", () => {
    expect(decideItem(validInput({
      placement: {
        itemId: "item-1",
        metrics: { uncoveredCriticalRegions: ["rightShoulder"] },
      },
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

  it("stops on infrastructure failures instead of quarantining the item", () => {
    expect(decideItem(validInput({
      structural: {
        pass: false,
        itemId: "item-1",
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
    [["artifacts"], "deterministic-cleanup"],
  ])("maps %j to %s", (regions, target) => {
    expect(classifyCorrection(regions)).toMatchObject({ target });
  });
});
