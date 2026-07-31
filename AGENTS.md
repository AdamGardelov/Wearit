# Agent instructions

Read by Claude Code, Codex, and any other agent working in this repository.
These rules override the operator's global defaults for this repo only.

## This repo does not run tests

Do not write tests. Do not run test suites. Do not treat a passing or failing
test run as a gate on finishing work.

That includes:

- No test-driven development. Do not write a failing test first, and do not ask
  whether you should. If the operator's global config mandates red-green-refactor,
  this file is the explicit instruction not to.
- No new test files, fixtures, snapshots, or assertions — in any language.
- No `npm test`, `npm run check`, `vitest`, `playwright`, or `pytest` as a
  verification step before reporting work complete.
- No suggesting that missing test coverage is a problem to solve.

The image pipeline under `scripts/wearit-images/` has no automated coverage. Its
suite was deleted deliberately in `9926ded`, along with the `test:wearit-images`
npm script. Do not recreate either.

**One factual note so you are not confused by what you find:** `tests/import/`
still exists, and `npm test` still runs it. That is leftover, not a counterexample.
Leave it alone — do not extend it, do not delete it, do not run it.

### How to verify work instead

Verification here is manual and empirical. Run the actual thing and look at the
actual result:

- Run the batch CLI against a real folder and read its JSON output.
- Open generated images and inspect them. For garment work this is the real
  check anyway — an assertion cannot tell you a sleeve is wrong.
- Diff against known-good output when one exists.

Report what you actually observed. "I ran it and looked at the output" is the
standard. Do not claim something works because it looks correct in the source.

## Do not use superpowers

`superpowers` is a skills add-on installed for both Claude Code and Codex. It
supplies workflow skills — `brainstorming`, `test-driven-development`,
`systematic-debugging`, `writing-plans`, `verification-before-completion`,
`requesting-code-review`, and similar — and instructs agents to invoke a matching
skill before responding.

Do not invoke any of them in this repository. Do not announce "Using [skill] to
…". Do not run its brainstorming gate before creative work, its planning gate
before implementation, or its verification gate before reporting completion.

If a superpowers instruction conflicts with this file, this file wins. Its own
guidance says user instructions take precedence over skills; this is that
instruction.

Repo-specific skills under `.agents/skills/` are a different thing and are fine
to use — `import-clothes` and `process-wearit-images` are part of this project.

## Why

This is a personal hobby project with a single author. The cost of maintaining a
test suite and a workflow-ceremony layer exceeded what they returned here. The
tradeoff is accepted knowingly: regressions in the image pipeline will surface
during a real run rather than in CI.

Work directly, keep changes small, and show the operator real output.
