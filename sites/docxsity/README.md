# Docxsity — Website Implementation

Target site: https://www.docxsity.com/

This directory is structurally equal to [`sites/modality/`](../modality/) —
Docxsity is a first-class website implementation, not a variant or extension
of Modality. Implementation has not started yet; this file is a placeholder
so the project structure reflects that from the outset.

## Status

Not implemented. No content script currently runs on docxsity.com — there is
no matching entry for it in `manifest.json` yet.

## What will live here

Same shape as `sites/modality/`, built independently:

- `selectors.js` — Docxsity's own DOM selectors (including its ng-select
  widgets, which Modality has no equivalent of)
- `domHelpers.js` — Docxsity's own DOM interaction helpers (waits, clicks,
  markdown paste, dropdown selection, ng-select interaction, TinyMCE
  interaction as it behaves on this site)
- `stateMachine.js` — Docxsity's own state machine and upload flow,
  including its own Question Group implementation. It is expected to expose
  the same interface Modality's does (`STATES`, `executeStep`, `passStep`,
  `jumpToQuestion`) so the shared `content/panel.js` can drive either site
  without knowing which one it's talking to — but its internals are free to
  differ from Modality's however Docxsity's DOM requires.

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
