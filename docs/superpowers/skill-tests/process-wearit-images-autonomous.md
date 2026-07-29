# Process Wearit Images autonomous baseline (RED)

## Tested skill baseline

- Path: `/home/adam/.codex/skills/process-wearit-images/SKILL.md`
- Tested at: `2026-07-29T11:03:16+02:00`
- SHA-256: `cdee6f328062a7cb09ee4aa32ca864211fade4562bd4a496be9414a9f02a2774`

## Scenario

> You have 200 jacket garments and no human is available for per-item review. One deterministic preview exposes mannequin arms and has malformed cuffs. Continue processing every other item, use at most three generation attempts for the bad item, and produce an accepted bundle plus quarantine report. Explain exactly when you pause.

## Nested subagent's full response

> This requires a single batch-level approval before image generation; it cannot safely skip review entirely.
>
> With that authorization, process in waves of ≤10 using automated hard gates.
>
> For the bad jacket:
>
> 1. Record the first failed deterministic preview (arms/mannequin pixels and malformed cuffs) in `run-state.json`.
> 2. Regenerate only that item, up to three total generation attempts.
> 3. After each attempt, run the locked dual-chroma removal and deterministic preview.
> 4. If attempt 3 still fails, mark it `quarantined`/`rejected`, preserve its sources and failed artifacts, and exclude it from `reviewed-items.v2.json`.
> 5. Continue all remaining 199 items; do not overwrite accepted items.
>
> Pause exactly twice:
>
> - Before image work: for one complete intake-table/batch approval.
> - After the third failed attempt: pause the bad item permanently and emit its quarantine record, but do not pause the rest of the queue.
>
> The final deliverables are:
>
> - An accepted bundle containing only the 199 passing garments, after normal dry-run/build/dry-run validation and tests.
> - A quarantine report naming the jacket’s source files, three failed attempt paths, failure reasons (“mannequin arms visible”, “cuffs malformed”), checksum, timestamp, and `excludedFromBundle: true`.
>
> If no batch-level approval or automated acceptance policy exists, stop before building: an “accepted” bundle would misrepresent unreviewed outputs.

## Criteria assessment

- Requires human intake or visual approval — **Observed failure.** Evidence: “This requires a single batch-level approval before image generation; it cannot safely skip review entirely.”
- Stops the batch on an item-quality failure — **Not observed.** Evidence: “Continue all remaining 199 items; do not overwrite accepted items.”
- Has no bounded retry-to-quarantine transition — **Not observed.** Evidence: “Regenerate only that item, up to three total generation attempts.” “If attempt 3 still fails, mark it `quarantined`/`rejected`, preserve its sources and failed artifacts, and exclude it from `reviewed-items.v2.json`.”
- Does not produce a machine-readable region verdict — **Observed failure.** Recorded deliverable: “A quarantine report naming the jacket’s source files, three failed attempt paths, failure reasons (“mannequin arms visible”, “cuffs malformed”), checksum, timestamp, and `excludedFromBundle: true`.”
