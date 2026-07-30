# Autonomous QA rubric

Use this rubric only with the exact deterministic preview produced by the batch
optimizer, together with the raw sources, product cutout, and fit master.

## Required JSON

Write exactly these 12 regions. Each region requires:

- `status`: `pass`, `fail`, or `uncertain`;
- `confidence`: a number from 0 to 1;
- `reason`: a non-empty, image-specific explanation.
- optional `applicable`: a boolean. Set it to `false` only for a sleeve or cuff
  that is genuinely absent from the source garment.

```json
{
  "schemaVersion": 1,
  "itemId": "item-uuid",
  "regions": {
    "sourceFidelity": { "status": "pass", "confidence": 0.97, "reason": "construction and colors match" },
    "collar": { "status": "pass", "confidence": 0.95, "reason": "seated at neckline" },
    "leftShoulder": { "status": "pass", "confidence": 0.95, "reason": "no gap" },
    "rightShoulder": { "status": "pass", "confidence": 0.95, "reason": "no gap" },
    "leftSleeve": { "status": "pass", "confidence": 0.96, "reason": "arm covered" },
    "rightSleeve": { "status": "pass", "confidence": 0.96, "reason": "arm covered" },
    "leftCuff": { "status": "pass", "confidence": 0.96, "reason": "wrist transition covered" },
    "rightCuff": { "status": "pass", "confidence": 0.96, "reason": "wrist transition covered" },
    "torso": { "status": "pass", "confidence": 0.95, "reason": "natural width and length" },
    "hem": { "status": "pass", "confidence": 0.95, "reason": "clean lower edge" },
    "visibleMannequin": { "status": "pass", "confidence": 0.98, "reason": "no body pixels inside garment coverage" },
    "artifacts": { "status": "pass", "confidence": 0.98, "reason": "no residue or holes" }
  }
}
```

For a genuinely sleeveless garment, keep all 12 regions and set
`"applicable": false` on `leftSleeve`, `rightSleeve`, `leftCuff`, and
`rightCuff`, with `status: "pass"`, confidence at least `0.9`, and a reason
that names the absent source construction. Never mark shoulders, torso, hem,
collar, source fidelity, visible mannequin, or artifacts non-applicable.

No region may be missing or added. Use `uncertain`, never `pass`, when the
preview does not show a region clearly. A `fail`, `uncertain`, or pass
confidence below `0.9` vetoes the whole item.

When opaque or mannequin-colored material occupies an intended
inner-arm-to-torso gap, fail the affected sleeve region(s), torso,
`visibleMannequin`, and `artifacts` as supported by the image. The coherent
cluster maps to the generation correction target `arm-torso-gaps`, preserves
`product-image`, and consumes one generation attempt. Other unsupported or
conflicting region combinations remain quarantine decisions.

## Region checks

| Region | Pass only when |
|---|---|
| `sourceFidelity` | Product and worn garment preserve source silhouette, proportions, construction, fabric, colors, pockets, closures, logos, artwork, and readable text. |
| `collar` | Collar/neckline shape matches the source and seats naturally with no gap, overlap, or mannequin leak. |
| `leftShoulder` | Left shoulder follows the mannequin with a continuous source-faithful seam and no hole or bulge. |
| `rightShoulder` | Right shoulder follows the mannequin with a continuous source-faithful seam and no hole or bulge. |
| `leftSleeve` | Left sleeve has correct length and volume, covers the intended arm area, and has no local distortion. |
| `rightSleeve` | Right sleeve has correct length and volume, covers the intended arm area, and has no local distortion. |
| `leftCuff` | Left cuff and wrist transition are source-faithful, closed, and free of exposed mannequin or malformed pixels. |
| `rightCuff` | Right cuff and wrist transition are source-faithful, closed, and free of exposed mannequin or malformed pixels. |
| `torso` | Torso width, closure line, waist, and length are plausible and match the source without local stretching. |
| `hem` | Lower edge is continuous, source-faithful, unclipped, and free of steps, holes, or residue. |
| `visibleMannequin` | No mannequin/body pixels appear where garment coverage is expected, especially arms, wrists, shoulders, neckline, and torso. |
| `artifacts` | No green/magenta residue, body fragments, background, detached islands, holes, jagged fringe, broad translucency, or generated debris. |

Judge left/right from the mannequin's perspective. Inspect sleeves and cuffs
independently: one good side never excuses a bad or unclear side. Do not use
scale or placement to pass a local shoulder, sleeve, cuff, torso, or hem defect.

Reasons must name the visible evidence, for example `right mannequin wrist
visible below malformed cuff`; do not write generic reasons such as `looks
good`.

