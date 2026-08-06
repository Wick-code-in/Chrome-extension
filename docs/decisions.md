# Docxsity Design Decisions

Intentional decisions worth preserving so they aren't rediscovered or accidentally reversed later. See [docxsity.md](docxsity.md) for how each plays out state-by-state and [architecture.md](architecture.md) for the broader philosophy these decisions sit inside.

---

## ADD_TAGS exists as its own state, separate from GENERATE_AI

Tagging (writing `question.subject` into the Tags & Sub Tags field) and AI content generation are unrelated site operations that happen to sit next to each other in the workflow — one write to a plain text input plus a button click, the other a long-running AI call with its own completion signal and failure mode. Keeping them as separate states means each can fail, retry, and be Pass-Stepped independently: a tagging failure doesn't force re-running AI generation, and vice versa. `runAddTags()` has exactly one responsibility — transfer the parsed `subject` field into a single top-level tag — and deliberately never touches "+ Sub Tag" (no sub-tag data exists anywhere in the parsed Question Object) or the pill's "Remove" button (a destructive action with no legitimate use in this workflow).

---

## Numerical (Fill Blank) questions skip PASTE_OPTIONS and MARK_CORRECT

Confirmed live: selecting Question Type "Fill Blank" removes the options mechanism from the form entirely — no option cards, no "Select Correct Answer," no per-option "Mark as Correct" buttons. In their place, Fill Blank has its own "Answers for Blanks" / "Case Sensitive Matching" controls, which are not automated at all. `determineNextState()` jumps directly from `PASTE_QUESTION` to `GENERATE_AI` for `NUMERICAL` questions, rather than running `PASTE_OPTIONS`/`MARK_CORRECT` handlers that would have nothing to act on. `runMarkCorrect()` additionally short-circuits to a manufactured `success:true` for `NUMERICAL` as defense in depth, in case it's ever reached directly (e.g. via Pass Step from a state before the skip takes effect). `ADD_TAGS` is deliberately **not** skipped for Fill Blank — it already runs unconditionally after `GENERATE_AI`, and `runAddTags()` itself is what decides whether there's a subject worth tagging.

---

## GENERATE_AI waits for completion in Docxsity (unlike Modality)

Modality's `GENERATE_AI` is click-only: it clicks "Generate with AI" and reports success immediately, on the premise that the extension is semi-automatic by design and the operator reviews AI output manually before continuing. Docxsity's `GENERATE_AI` instead waits for the full generation cycle (a two-phase disabled → enabled wait) and verifies the Explanation field actually contains text before reporting success.

This wasn't a philosophical break from Modality's semi-automatic design — it reflects a difference in what "clicked" actually proves on this site. Docxsity's generate button visibly toggles a `disabled` attribute for the duration of generation and was directly observed, live, completing a real generation in roughly 1.5 seconds; waiting for that cycle to finish and checking that content landed is a cheap, reliable signal that generation actually happened, not an assumption that a click alone accomplished it. The 30-second timeout (`GENERATE_AI_TIMEOUT_MS`, versus the 10-second default used elsewhere) exists because that one observed sample is not treated as a guaranteed upper bound for a live AI service.

**On failure** (either wait times out, or the Explanation field reads empty after both waits succeed): the workflow deliberately stays in `GENERATE_AI` — `executeStep()` never advances the session state on a failed result. This means Execute Step can be pressed again to retry, or the operator can use Pass Step to move on manually if that's the right call for this question. This is confirmed, intended behavior, not an unhandled edge case — the two other failure paths that currently surface a generic DOM-selector-laden timeout message (rather than something more operator-friendly) are a known, explicitly deferred polish item, not something scheduled for this milestone.

---

## Question Groups are out of scope for Docxsity

Docxsity's implementation only ever creates and automates a standalone Add Question form. It has no equivalent of Modality's `resolveCurrentRoot()`/`ensureQuestionFormReady()` machinery, no Sub Question card handling, no group-aware Save path, and no group-redirect logic in `jumpToQuestion()`. Every question is treated as independent, matching the scope of what has actually been built and live-verified — this is a deliberate scope boundary, not an oversight, and extending Docxsity to Question Groups would be new, separately-scoped work following the same reconnaissance-first discipline as everything else, not something to be inferred or half-implemented from Modality's existing group code.

---

## Per-option "Mark as Correct" button, not the Correct Answer dropdown

Docxsity exposes two ways to mark a correct answer that stay bidirectionally synced: a per-option "Mark as Correct" button on each option card, and a separate "Select Correct Answer" summary control. The summary control's underlying element type differs by context — a native `<select>` on a standalone form, an `<ng-select>` inside a (Modality-only) Sub Question card, confirmed live — while the per-option button is identical in every context. Since Docxsity only ever automates the standalone form, this difference doesn't currently bite, but the button was chosen specifically because it's the one control whose interaction shape doesn't depend on context, keeping `runMarkCorrect()` simple and not coupled to a distinction the code doesn't otherwise need to make.

---

## Marking scheme lives in its own config module, not embedded constants

`sites/docxsity/config/markingSchemes.js` holds a single `MARKING_SCHEMES` map (`JEE`, `UPSC_PAPER_I`, `UPSC_PAPER_II`) behind `getMarkingScheme(examType)`, which returns `null` for anything unconfigured. `runPrepareForm()` fails closed on that `null` — non-retryable, naming the exact file to edit — rather than falling back to a guessed default. This intentionally duplicates the same marking-scheme values Modality keeps as embedded constants (`PREPARE_FORM_MARKS_VALUE`/`MARKS_PENALTY_BY_UPSC_PAPER`) rather than sharing one source of truth between the two sites, consistent with the broader site-isolation rule in [architecture.md](architecture.md) — and Docxsity's own values differ in shape anyway, since Penalty is filled unconditionally here (see the Numerical-Penalty note in [docxsity.md](docxsity.md)) while Modality only fills it for MCQ. A future shared `lib/` migration for marking schemes has been discussed but deliberately deferred, not started.

---

## The modal-root-once pattern, re-resolved every state

Every state that touches the Add Question modal calls `waitForElement(Selectors.addQuestionModal)` itself, fresh, rather than trusting a root element handed down from a previous state. This costs one near-instant wait per state (the modal is already open by then) in exchange for never scoping a lookup to a DOM reference that might have gone stale — deliberately paranoid given that Angular can, in principle, replace parts of the page wholesale rather than mutating them in place. See [architecture.md](architecture.md) for the full reasoning and its relationship to `waitForElement()`'s choice to observe `document.documentElement` rather than any particular `root`.

---

## The panel-wide busy guard lives in shared code (`content/panel.js`)

When the Execute Step re-entrancy gap was found (see [debugging-notes.md](debugging-notes.md)), the fix was deliberately placed in the shared panel file rather than as a guard inside `sites/docxsity/stateMachine.js`. The gap is a property of how `content/panel.js` wires its own button click handlers against an async `executeStep()` call — it exists identically for Modality, since both site state machines expose the same async `executeStep()`/sync `passStep()`/`jumpToQuestion()` shape. Fixing it per-site would have meant duplicating the same guard twice and risking the two copies drifting; fixing it once in the file both sites already share was the direct application of the project's stated exception: `content/*` changes only with explicit agreement that the change is genuinely site-independent logic, which this is.
