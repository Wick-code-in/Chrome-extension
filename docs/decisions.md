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

## Docxsity now has its own Question Group implementation (supersedes the original "out of scope" decision)

**This decision was reversed.** The original entry (preserved in git history, not reproduced here) stated Docxsity's implementation only ever created a standalone Add Question form, with no equivalent of Modality's group machinery at all, as a deliberate scope boundary. That was accurate when written. It stopped being accurate once Docxsity's own Question Group runtime was built (Phases 3A–3C, committed together with NDA Mathematics support in `654f040`) — see [docxsity.md](docxsity.md)'s "Question Groups" section for the full architecture, phase history, and DOM findings. This entry now records *why* it changed and the decisions made in changing it, rather than the boundary itself.

**Why the scope changed:** NDA Mathematics parses 27 shared-instruction blocks (governing 59 of its 120 questions) into real, non-null `group` metadata, in the same shape UPSC Paper II already uses. Uploading NDA to Docxsity via the old flatten-and-duplicate path (shared instruction folded inline into each question's own text) remained technically possible, but the user explicitly directed that Docxsity should instead gain real Question Group support — matching how Modality already handles the same kind of data — rather than accepting the flattened, duplicated-instruction presentation as permanent for this site.

**Docxsity built its own implementation, not a port of Modality's.** `resolveCurrentRoot()`, `ensureQuestionFormReady()`, `computeSubQuestionLetter()`, and every `Selectors.questionGroup` entry are Docxsity's own code, independently verified against Docxsity's real DOM (separate modal type, `<span class="qm-sq-label">` instead of Modality's `<h4>`, a "Save Question" button whose text collides with the standalone modal's own, an accordion-collapse behavior Modality doesn't have) — not copied or generalized from Modality's implementation. This follows the project's standing site-isolation rule directly (see [architecture.md](architecture.md)): `domHelpers.js` stays generic on both sites; Question Group *behavior* is site-specific orchestration living entirely in each site's own `stateMachine.js`, even though the two sites' orchestration ends up looking similar in shape. No new `domHelpers.js` primitive was needed on either site to build this.

**No NDA-specific group runtime was created anywhere.** Both sites' group-handling code is driven purely by `question.group` — never by exam type, never by a check for `NDA_MATHEMATICS` specifically. `jumpToQuestion()`'s redirect and `runSave()`'s group-position check are both examples: they key off `question.group`/`question.group.isLastInGroup`, so any current or future exam type whose parser output includes group metadata gets the same behavior for free, exactly as happened for NDA.

**No automatic modal cleanup was introduced.** The stacked-modal limitation (`PREPARE_FORM` invoked while a group's own modal is already open opens a second, stacked modal instead of reusing it) is inherited on both sites and was deliberately left as-is — see [docxsity.md](docxsity.md) for the full description. Fixing it would be new, separately-scoped work, not something to bolt onto this change.

---

## Question Groups represent any shared multi-question instruction, not only passages

When Docxsity's Question Group runtime was first built (previous entry), every real example available — UPSC Paper II, then NDA Mathematics — happened to share a genuine passage or stem: content a reader needs in order to answer the governed questions. GAT's Part A ([nda-gat.md](nda-gat.md)) introduced the first case where a shared Directions/instruction block governs multiple questions with **no separate passage at all** — 9 of GAT's 10 Part A blocks are a bare instruction sentence ("The following items have a sentence in direct or indirect speech...") immediately followed by the first governed question, nothing in between.

**The decision made:** these are still Question Groups. The deciding criterion for whether a block of questions forms a Question Group is *"does one common instruction/direction govern multiple consecutive questions,"* not *"is there a passage."* `group.instructionMarkdown` holds whichever kind of shared text actually exists — a real passage (UPSC/NDA Mathematics/GAT's Q1–5) or the Directions sentence itself (GAT's other 9 blocks) — decided per-block by the parser via a purely structural test (is there real content between the Directions marker and the first governed question, or not — see [nda-gat.md](nda-gat.md) §2), never by a keyword check on the instruction's own wording.

**Why this matters architecturally:** neither `questionGroupsByQuestionIndex()` nor any consumer of `question.group` on either site was changed to support this — the existing schema and runtime already treat `instructionMarkdown` as opaque text, never inspecting what kind of content it holds. This is confirmation, not coincidence: the schema was already general enough, and GAT is the proof case that exercised the generality rather than requiring new capability. The rule going forward is the same one this decision states: a new exam whose source has any shared-instruction structure — passage-bearing or not — should map onto the existing `group` model as-is, not prompt a parallel or extended representation.

---

## Per-option "Mark as Correct" button, not the Correct Answer dropdown

Docxsity exposes two ways to mark a correct answer that stay bidirectionally synced: a per-option "Mark as Correct" button on each option card, and a separate "Select Correct Answer" summary control. The summary control's underlying element type differs by context — a native `<select>` on a standalone form, an `<ng-select>` inside a (Modality-only) Sub Question card, confirmed live — while the per-option button is identical in every context. Since Docxsity only ever automates the standalone form, this difference doesn't currently bite, but the button was chosen specifically because it's the one control whose interaction shape doesn't depend on context, keeping `runMarkCorrect()` simple and not coupled to a distinction the code doesn't otherwise need to make.

---

## Marking scheme lives in its own config module, not embedded constants

`sites/docxsity/config/markingSchemes.js` holds a single `MARKING_SCHEMES` map (`JEE`, `UPSC_PAPER_I`, `UPSC_PAPER_II`, `NDA_MATHEMATICS`) behind `getMarkingScheme(examType)`, which returns `null` for anything unconfigured. `runPrepareForm()` fails closed on that `null` — non-retryable, naming the exact file to edit — rather than falling back to a guessed default. This intentionally duplicates the same marking-scheme values Modality keeps as embedded constants (`PREPARE_FORM_MARKS_VALUE`/`MARKS_PENALTY_BY_UPSC_PAPER`) rather than sharing one source of truth between the two sites, consistent with the broader site-isolation rule in [architecture.md](architecture.md) — and Docxsity's own values differ in shape anyway, since Penalty is filled unconditionally here (see the Numerical-Penalty note in [docxsity.md](docxsity.md)) while Modality only fills it for MCQ. A future shared `lib/` migration for marking schemes has been discussed but deliberately deferred, not started. The NDA Mathematics addition (marks 2.5, penalty 0.83 — identical values to `UPSC_PAPER_II`, coincidentally) followed this same duplication convention: the entry was added to both this map and Modality's own `MARKS_PENALTY_BY_UPSC_PAPER` (`sites/modality/stateMachine.js`) by hand, independently, rather than sharing a source.

---

## Question Type selector values track Docxsity's live UI labels, not an internal enum — and can silently go stale

`sites/docxsity/selectors.js`'s `MCQ_OPTION_VALUE`/`FILL_BLANK_OPTION_VALUE` are the exact visible text of the Question Type `ng-select`'s options, not any internal/API value Docxsity might use behind the scenes — matching this project's general selector philosophy of anchoring to stable visible structure (see [architecture.md](architecture.md)). This makes the automation exactly as robust as the site's own displayed labels, which turned out to be less stable than assumed: verified `"MCQ Choice"` on 2026-08-06, re-verified 2026-09-01 (during GAT work, but affecting every exam type equally, not GAT-specific) to have silently become `"Multiple Choice Question"`, alongside a new sixth option (`"Multiple Select Question"`) that hadn't existed before. `"Fill Blank"` was unaffected.

**The failure mode this produced is worth recording:** `DomHelpers.selectDropdown()`'s idempotent check (skip re-selecting if the ng-select already shows the target value) meant the stale value didn't error immediately — Docxsity's own default selection ("Multiple Choice Question") already matched what an operator would want, it just didn't match the *string* `PREPARE_FORM` was comparing against, so the dropdown appeared correct visually while the automation would have gone on to search for a nonexistent `"MCQ Choice"` option and time out. This is exactly the class of failure [architecture.md](architecture.md)'s "why states verify completion instead of assuming success" describes in the abstract — here it surfaced as `Session` reporting 0 questions loaded on the panel with no explicit parse-failure message, since the panel's own status text is the loader's file-read success message, not a reflection of parse/selection outcomes (see [debugging-notes.md](debugging-notes.md)).

**The fix stayed entirely at the selector-value level.** `DomHelpers.selectDropdown()` was already fully generic — it takes whatever value string it's given and searches `.ng-option` elements for a text match, with zero hardcoded label knowledge — so it needed no change, and neither did `stateMachine.js`'s call sites, which already just forward `selectors.mcqOptionValue` without caring what the string is. Updating one constant in `sites/docxsity/selectors.js` fixed MCQ selection uniformly across every exam type and both standalone/grouped contexts, with no exam-specific branching introduced anywhere — confirming that keeping all hardcoded selector values isolated to this one file, per the project's existing selector-philosophy rule, is exactly what made this a one-file fix rather than a hunt through multiple call sites.

**Lesson for future maintenance:** a site-driven label rename can look identical, from the operator's perspective, to the field already being correctly defaulted — the value mismatch is invisible in the UI until the automation actually needs to search for the stale string. Re-verifying `sites/docxsity/selectors.js`'s literal option-text values periodically (or when a "buttons disabled with no error" report comes in) is cheaper than waiting for it to surface as a confusing zero-questions-loaded report, as it did here.

---

## The modal-root-once pattern, re-resolved every state

Every state that touches the Add Question modal calls `waitForElement(Selectors.addQuestionModal)` itself, fresh, rather than trusting a root element handed down from a previous state. This costs one near-instant wait per state (the modal is already open by then) in exchange for never scoping a lookup to a DOM reference that might have gone stale — deliberately paranoid given that Angular can, in principle, replace parts of the page wholesale rather than mutating them in place. See [architecture.md](architecture.md) for the full reasoning and its relationship to `waitForElement()`'s choice to observe `document.documentElement` rather than any particular `root`.

---

## The panel-wide busy guard lives in shared code (`content/panel.js`)

When the Execute Step re-entrancy gap was found (see [debugging-notes.md](debugging-notes.md)), the fix was deliberately placed in the shared panel file rather than as a guard inside `sites/docxsity/stateMachine.js`. The gap is a property of how `content/panel.js` wires its own button click handlers against an async `executeStep()` call — it exists identically for Modality, since both site state machines expose the same async `executeStep()`/sync `passStep()`/`jumpToQuestion()` shape. Fixing it per-site would have meant duplicating the same guard twice and risking the two copies drifting; fixing it once in the file both sites already share was the direct application of the project's stated exception: `content/*` changes only with explicit agreement that the change is genuinely site-independent logic, which this is.
