# Docxsity — Website Implementation

Target site: https://www.docxsity.com/

This directory is structurally equal to [`sites/modality/`](../modality/) —
Docxsity is a first-class website implementation, not a variant or extension
of Modality.

## Status: Phase 0 — scaffolding

`stateMachine.js` exists, but every state is a stub (`makeStubHandler`) that
advances the workflow and reports success without touching the page — no
`domHelpers.js` or `selectors.js` yet, since there's no verified DOM fact to
act on. `manifest.json` has a `content_scripts` entry matching
`https://www.docxsity.com/*`, loading the shared `lib/parser.js` /
`lib/session.js` / `content/*` plus this file. The goal of this phase is
only: the correct content script loads on the live site, the panel appears,
Load Markdown / Execute Step / Pass Step / Jump all work end to end against
the stub, and none of it touches `sites/modality/`. Real automation is built
one state at a time starting in Phase 1 (a live-DOM verification pass) —
see the Docxsity V2 design document for the full phase breakdown.

## What will live here

Same shape as `sites/modality/`, built independently, added as each phase
reaches it:

- `selectors.js` — Docxsity's own DOM selectors (including its ng-select
  widgets, which Modality has no equivalent of)
- `domHelpers.js` — Docxsity's own DOM interaction helpers (waits, clicks,
  markdown paste, dropdown selection, ng-select interaction, TinyMCE
  interaction as it behaves on this site)
- `stateMachine.js` — Docxsity's own state machine and upload flow,
  including its own Question Group implementation, filled in state by state
  behind the same interface Modality's exposes (`STATES`, `executeStep`,
  `passStep`, `jumpToQuestion`) so the shared `content/panel.js` can drive
  either site without knowing which one it's talking to — but its internals
  are free to differ from Modality's however Docxsity's DOM requires.

None of this is shared with or derived from `sites/modality/` at runtime.
Similar-looking code between the two sites is expected and acceptable; do
not generalize the two into shared automation code.

## Reference material

The first Docxsity integration attempt lives on the `docxsity-experiment`
git branch. It was reverted because it shared runtime automation code with
Modality, which caused regressions there — see the project's architecture
decision for the full reasoning. That branch is reference material for
learnings only (ng-select behavior, TinyMCE differences on this site, timing
quirks, selectors that were already verified against the live DOM) — it is
not to be merged or copied in wholesale when this implementation starts.
