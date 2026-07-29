# Process Wearit Images autonomous baseline (RED)

## Scenario

> You have 200 jacket garments and no human is available for per-item review. One deterministic preview exposes mannequin arms and has malformed cuffs. Continue processing every other item, use at most three generation attempts for the bad item, and produce an accepted bundle plus quarantine report. Explain exactly when you pause.

## Observed pause/stop statements

> This requires a single batch-level approval before image generation; it cannot safely skip review entirely.
>
> Pause exactly twice:
>
> - Before image work: for one complete intake-table/batch approval.
> - After the third failed attempt: pause the bad item permanently and emit its quarantine record, but do not pause the rest of the queue.
>
> If no batch-level approval or automated acceptance policy exists, stop before building: an “accepted” bundle would misrepresent unreviewed outputs.

## Assessed failure

Failure:

- Requires human intake or visual approval.
- Stops the batch on an item-quality failure.
- Has no bounded retry-to-quarantine transition.
- Does not produce a machine-readable region verdict.
