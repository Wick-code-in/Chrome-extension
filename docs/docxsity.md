# Docxsity State Flow

Target site: https://www.docxsity.com/. This document describes what each state in `sites/docxsity/stateMachine.js` does, how it knows it succeeded, how it fails, and anything intentionally different from the Modality implementation (`sites/modality/stateMachine.js`). For *why* these decisions were made, see [decisions.md](decisions.md) and [architecture.md](architecture.md). For the `NDA_MATHEMATICS` exam type that first exercised this runtime's Question Group support with real data, see [nda-mathematics.md](nda-mathematics.md).

State order: `IDLE → PREPARE_FORM → PASTE_QUESTION → PASTE_OPTIONS → MARK_CORRECT → GENERATE_AI → ADD_TAGS → SAVE → NEXT_QUESTION → (PREPARE_FORM | COMPLETE)`.

Fill Blank (`NUMERICAL`) questions skip `PASTE_OPTIONS` and `MARK_CORRECT` entirely — `determineNextState()` jumps straight from `PASTE_QUESTION` to `GENERATE_AI` for that type. See [decisions.md](decisions.md) for why.

---

## Question Groups

**This section documents the final architecture.** Earlier revisions of this document (and of [decisions.md](decisions.md)) stated that Question Groups were out of scope for Docxsity — that was true when written, and is no longer true. Docxsity has its own, independently-built Question Group runtime, committed alongside NDA Mathematics support (`654f040`, "Question group added in docxsity"). This section explains the shared concept, the Modality implementation it was built by studying (not copying), Docxsity's own implementation, the DOM facts behind it, and what's still a known limitation.

### The shared concept

A Question Group is `lib/parser.js`'s representation of a block of questions that share one instruction/passage/stem, printed once on the source paper and governing several independently-numbered questions after it. The parser attaches this metadata to each governed question as a `group` field:

```js
group: {
  id,                   // stable identity, shared by every member of one group
  instructionMarkdown,  // the shared instruction/passage text, once
  questionNumbers,      // e.g. [31, 32, 33] — every member's original question number
  isFirstInGroup,       // true only for questionNumbers[0]
  isLastInGroup,        // true only for the last entry
}
```

or `null` for a standalone question. This shape is exam-agnostic — the same `questionGroupsByQuestionIndex()` function in `lib/parser.js` produces it for UPSC Paper II and for NDA Mathematics alike (see [nda-mathematics.md](nda-mathematics.md) for NDA's specific parser path). **Nothing about the `group` field or its producer is Docxsity-specific** — a *runtime* (a site's `stateMachine.js`) is what decides what to actually do with it, and the two sites decide differently.

### Modality's implementation (the studied precedent)

Modality (`sites/modality/stateMachine.js`) implemented Question Groups first, for UPSC Paper II. Docxsity's own implementation was designed by reading and understanding this code, not by importing or sharing it — the two are independent, following the project's standing site-isolation rule (see [architecture.md](architecture.md)).

- **First member identification**: `question.group.isFirstInGroup`. **Subsequent members**: `!isFirstInGroup`, distinguished from the last member by `isLastInGroup`.
- **Sub-question letters**: `computeSubQuestionLetter(question)` finds `question.questionNumber`'s position within `question.group.questionNumbers` (0-indexed) and converts that position to a letter (`String.fromCharCode(97 + position)` — position 0 → "a", 1 → "b", …). The letter is derived from *array position*, not from the question's own number, which is what makes it work correctly regardless of what the original question numbers actually are.
- **`ensureQuestionFormReady(question)`** is the entry point that gets the form into a ready state and returns the root later fields should be scoped to:
  - For a standalone question (`!question.group`): click "Add Question", wait for the Marks field, root is `document` (Modality's standalone form has no container of its own to scope to).
  - For a group member: if `isFirstInGroup`, click "Add Question Group" and paste `group.instructionMarkdown` into the Instruction/Title field — **only for the first member**, since the group modal (and its instruction) is a one-time, whole-group thing, not per-question. If not first, this paste is skipped entirely — the group modal from the first member's own `ensureQuestionFormReady()` call is assumed still open. Then, **unconditionally for every member including the first**, click "Add Sub Question" and wait for that specific lettered card to appear — every member, first or not, gets its own sub-question card, because the shared instruction and each member's own question/options/answer are genuinely different pieces of data that need their own form fields.
- **`resolveCurrentRoot(question)`** — a *lookup-only* counterpart used by every later state (PASTE_QUESTION onward): `document` for standalone, or the specific already-existing lettered Sub Question card (`Selectors.questionGroup.subQuestionCard(letter)`) for a group member. This is what scopes each state's field lookups to the correct sub-question rather than the whole page.
- **SAVE**: only the group's **last** member (`isLastInGroup`) ever reaches `SAVE` — a Question Group is saved once, as a whole, not per sub-question. `determineNextState()` special-cases this: from `GENERATE_AI`, if `question.group && !question.group.isLastInGroup`, the next state is `NEXT_QUESTION` directly (skipping `ADD_TAGS`/`SAVE` entirely) — this branch is nested inside Modality's `isUpscExamType()` check, since UPSC/NDA are the only exam types with group data in practice today (see [nda-mathematics.md](nda-mathematics.md) §4 for the NDA-specific extension to that predicate).
- **Pass Step inherits this same transition logic** — `passStep()` calls the exact same `determineNextState()` a non-last group member's Execute Step would have used, so skipping a state manually via Pass Step produces the identical group-aware transition as running it automatically.
- **Jump redirect**: `jumpToQuestion(rawInput)` looks up the target question and, if it belongs to a group and is not that group's first member, redirects to the group's first question instead — a Question Group can only be created on the website sequentially, starting from its first sub-question, so there is no valid entry point into the middle of one. This is a hard site constraint, not a convenience choice.

### Docxsity's own implementation

Built across three phases, each independently reconnaissance-first per the project's working rule (see [[feedback_docxsity_working_rule]]):

- **Phase 3A — creation foundation.** New `Selectors.questionGroup` section (`addQuestionGroupButton`, `addQuestionGroupModal`, `instructionMarkdownButton`, `addSubQuestionButton`, `subQuestionCard(letter)`, `subQuestionLetterByPosition(position)`) plus `computeSubQuestionLetter()`, `resolveCurrentRoot()`, and `ensureQuestionFormReady()` in `stateMachine.js` — Docxsity's own versions of the Modality functions described above, independently verified against Docxsity's real DOM (see below), not assumed transferable from Modality's shapes. Standalone behavior fully preserved: `!question.group` still takes the exact pre-existing "Add Question" path.
- **Phase 3B — field/root scoping.** `resolveCurrentRoot(question)` wired into every remaining per-question state: `PASTE_QUESTION`, `PASTE_OPTIONS`, `MARK_CORRECT`, `GENERATE_AI`, `ADD_TAGS`. Grouped questions use `question.questionOnlyMarkdown` (not `questionMarkdown`) for their own Question Text, so the shared instruction is never pasted twice. No new selectors were needed for these fields — Question Text, Options, Marks, Penalty, and the per-option Mark-as-Correct button were confirmed byte-identical in class/label to the standalone form's own selectors, just scoped to whichever root the caller resolves.
- **Phase 3C — group-aware SAVE lifecycle.** `determineNextState()`'s `GENERATE_AI` branch: `if (question.group && !question.group.isLastInGroup) return "NEXT_QUESTION"` — **unconditional on `question.group`, deliberately not gated by exam type**, unlike Modality's equivalent check. This is a genuine, intentional divergence: Docxsity's `runAddTags()` already self-gates on `question.subject` existing, independent of exam type, so there was no reason to bundle the group-skip decision with an exam-type predicate the way Modality does. `runSave()` resolves the correct modal to save (`Selectors.questionGroup.addQuestionGroupModal` if `question.group`, else `Selectors.addQuestionModal`) — deliberately **not** via `resolveCurrentRoot()`, since for a grouped question that resolves the *sub-question card*, the wrong root for the group-wide Save button. `jumpToQuestion()` gained the identical group-member redirect-to-first logic described above for Modality, independently implemented against Docxsity's own `Selectors`/`Session`.

### Docxsity's native group DOM (verified live)

- **"Add Question Group"** opens its own, separate `<ngb-modal-window>` — not a mode within the standalone Add Question modal. Heading: `<h2>Add Question Group</h2>` (vs. `<h2>Add Question</h2>` for standalone) — the two headings are how `runSave()` (see above) tells which modal is actually open.
- **"Add Sub Question"** button, inside the group modal, clicked once per member (including the first, after the instruction is pasted).
- Each sub-question's root is `<div class="qm-sq-card">` — **not** an `<h4>`, unlike Modality's Sub Question cards. Its identifying text lives in a sibling `<span class="qm-sq-label">Sub Question a</span>` inside the card's header; `closest()` walks up from that span to find the card.
- The group's shared instruction has its own field, labeled **"Instruction / Title \*"** — same TinyMCE "Paste Raw Markdown" → "Paste Markdown Data" import flow as every other rich-text field on the site (Question Text, each Option).
- Inside each sub-question card: the same Question Type/Marks/Penalty/Difficulty fields and the same 4 option cards with the same per-option "Mark as Correct" button (`button.qm-correct-btn`) as the standalone form — confirmed byte-identical, no new selectors needed for these.
- **"Save Question"** exists inside the group modal too, with the identical visible text as the standalone modal's own Save button — this is exactly why `runSave()` must scope to the correct modal via `question.group` rather than searching unscoped.

**Accordion behavior — verified, with an important correction to what might be assumed:**

Only the most-recently-added sub-question card is expanded (full form fields, TinyMCE editors, ~300+ interactive elements); every earlier card in the same group collapses to a small header-only summary (~1-3KB of DOM, effectively just its `<span class="qm-sq-label">` and one icon button) the moment the next card is created. This was directly observed during Phase 4B live testing.

**Collapsed cards do retain their underlying data** — inferred from successful multi-member group SAVEs (Q31–33, Q34–35, Q36–38, Q46–47, Q99–100, Q101–103 all saved correctly as whole groups with only the last card ever expanded at SAVE time; the site's own validation never complained about an earlier, long-collapsed member).

**What was *not* established, and should not be assumed:** whether a working "re-expand" affordance exists for a collapsed card. During Phase 4B, the single button remaining on a collapsed card was investigated directly and found to be **`title="Remove Sub Question"` (a delete action, class `qm-icon-btn--danger`) — not an expand/collapse toggle.** Clicking it (done once, accidentally, during testing) deletes that sub-question from the group and relabels the remaining cards' letters accordingly (e.g. deleting "a" from a 3-member group relabels the former "b"/"c" to "a"/"b", *retaining their actual data* — confirmed by inspecting the relabeled cards' content after the accidental deletion). If a genuine expand-to-inspect control exists elsewhere in the UI, it was not found during this project's testing — do not assume one exists without verifying first.

A fresh group's first sub-question card was not specifically checked for its starting option-card count (4 vs. fewer, the same variability documented for the standalone form in `PASTE_OPTIONS` below) — `ensureOptionCount()` handles either starting point correctly by construction regardless, so this was never load-bearing enough to require checking, but it should not be read as "verified to always start with 4."

### Known limitation: stacked modals

**If a group's `PREPARE_FORM` is invoked while that same group's modal is already open** (e.g. the operator Jumps away from a mid-group question and Jumps back to it, or double-invokes Execute Step), `ensureQuestionFormReady()` sees `isFirstInGroup: true` again and clicks "Add Question Group" a second time. Docxsity does not block this — `element.click()` bypasses whatever visual backdrop-blocking the site itself has, live-verified to open a second, empty Group modal stacked on top of the still-open, unsaved one, rather than reusing it. The identical limitation exists for the standalone "Add Question" button under the same circumstance.

This is an **inherited, deliberately unfixed limitation** — `jumpToQuestion()` performs no modal-detection or cleanup, on either site. The operator remains responsible for closing an abandoned/stacked modal manually, consistent with how every other retryable failure in this project is handled. Recorded here as a known fact, not proposed as something to fix.

### Live validation history for this runtime

Phases 3A–3C were validated with synthetic (hand-constructed) test data against disposable Docxsity banks before any real exam data existed with group metadata worth testing. NDA Mathematics (Phase 4B) was the first real-parser-data validation of this runtime — see [nda-mathematics.md](nda-mathematics.md) §5 for that full history, including what was and wasn't live-tested, and §7 for the one content-pipeline finding (unrelated to this runtime) that stopped that testing pass early.

---

## IDLE

**Purpose:** the state before any per-question automation has run. Performs no DOM interaction at all.

**Completion signal:** `Session.hasCurrentQuestion()` is true.

**Failure handling:** no questions loaded → `success:false, retryable:true`, "No questions loaded. Load and parse a Markdown file first."

**Modality difference:** none — same shape, same message.

---

## PREPARE_FORM

**Purpose:** open the Add Question modal, select the Question Type (`MCQ Choice` or `Fill Blank`), and fill Marks and Penalty from the exam's marking scheme.

Sequence: look up `MarkingSchemes.getMarkingScheme(examType)` (fails closed if unconfigured) → click "Add Question" → wait for the modal (`addQuestionModal`, resolves the workflow's root for this question) → `selectDropdown()` the Question Type ng-select → `fillInput()` Marks → `fillInput()` Penalty.

**Completion signal:** each step's own DOM helper result; the modal wait and the idempotent `selectDropdown()` are the load-bearing ones (a Question Type ng-select already showing the right value is treated as success without re-clicking).

**Failure handling:**
- `question.hasImage` → immediate `retryable:true` pause: "This question contains an image. Insert it manually on the target website, then click Execute Step to continue."
- Question type not `MCQ`/`NUMERICAL` → non-retryable failure directing the operator to fix the source markdown and Jump back.
- No marking scheme configured for the exam type → non-retryable failure naming the exact file to edit (`sites/docxsity/config/markingSchemes.js`) — fail-closed, never guesses a value.
- Any DOM step (click/wait/select/fill) failing propagates that step's own message.

**Key decision:** Penalty is filled **unconditionally**, for both MCQ and Fill Blank — Docxsity's Penalty field stays present and enabled regardless of Question Type (verified live by switching types and re-checking the field).

**Modality difference:** Modality skips Penalty entirely for its non-MCQ type; Docxsity does not, because the field itself behaves differently on this site. Both sites' `ensureQuestionFormReady()` now handle both a standalone question and a Question Group member (Sub Question card) — see [Question Groups](#question-groups) above for Docxsity's own version, built independently from Modality's.

---

## PASTE_QUESTION

**Purpose:** paste the question's markdown into the Question Text field via TinyMCE's "Paste Raw Markdown" → "Paste Markdown Data" import flow.

**Completion signal:** `pasteMarkdown()`'s wait for the import dialog to disappear after "Render & Insert" is clicked.

**Failure handling:** no `question.questionMarkdown` → non-retryable failure. Any step inside `pasteMarkdown()` (trigger click, dialog wait, textarea fill, confirm click, disappear wait) propagates its own retryable failure.

**Key decision:** the workflow's root is re-resolved fresh via `resolveCurrentRoot(question)` at the start of this state rather than reusing a reference from `PREPARE_FORM` — state handlers never carry DOM references between each other. For a standalone question this resolves the Add Question modal (settling near-instantly, since it's already open); for a Question Group member it resolves that member's own Sub Question card (see [Question Groups](#question-groups)). Grouped questions read `question.questionOnlyMarkdown` (the shared instruction already lives in the group's own Instruction field, must not be duplicated); standalone questions read `question.questionMarkdown`, byte-identical to `questionOnlyMarkdown` when there's no group. The import dialog itself is looked up **unscoped** (document-wide, not scoped to any modal or card) because it is a TinyMCE-native dialog appended directly to `document.body`, confirmed live to not be a descendant of either.

**Modality difference:** functionally aligned — both sites now distinguish `questionOnlyMarkdown` from `questionMarkdown` for group members via their own independent `resolveCurrentRoot()`. No architecturally significant difference remains for this state.

---

## PASTE_OPTIONS

**Purpose:** ensure exactly 4 option cards exist, then paste each option's markdown into its card, in letter order A–D.

This state is composed of two deliberately separate responsibilities:

1. **`ensureOptionCount(root, 4)`** — for each position 1–4, checks (read-only) whether that card already exists; if not, clicks "Add Option" once and waits for that specific card to appear before considering the next position. Never blind-clicks ahead of what it has observed.
2. **`runPasteOptions()`** — once a card is known to exist, reuses `pasteMarkdown()` unchanged, scoped to that option's own card as `root`.

**Completion signal:** the last option's `pasteMarkdown()` dialog-disappear wait.

**Failure handling:** `question.options` missing → non-retryable failure. A specific option's text missing → non-retryable failure naming the letter. Any DOM step failure (card creation, paste) propagates.

**Key decision:** the starting option-card count is not assumed to be a fixed default. Docxsity's Question Type control itself resizes the options array on real UI interaction (confirmed live: selecting "Fill Blank" collapses cards to 0, selecting "MCQ Choice" back populates exactly 4 empty cards) — whether this has already fired by the time `PASTE_OPTIONS` runs depends on that Add Question modal's interaction history. `ensureOptionCount()` is written to be correct from either starting point by construction, rather than assuming a fixed baseline. This was investigated and confirmed as real site behavior, not a bug — see [debugging-notes.md](debugging-notes.md).

**Modality difference:** Modality has no equivalent `ensureOptionCount()` step — it assumes 4 options always exist and iterates `OPTION_LETTERS` directly. Docxsity needs the extra step because of the option-resizing behavior above.

---

## MARK_CORRECT

**Purpose:** click the correct option's own "Mark as Correct" button, scoped to that option's card.

**Completion signal:** waits for `button.qm-correct-btn.qm-correct-btn--active` inside that specific card — an observed DOM state, not a fixed delay.

**Failure handling:**
- `question.type === "NUMERICAL"` → Fill Blank has no correct-answer mechanism at all (its "Answers for Blanks" / "Case Sensitive Matching" replace it entirely) — returns a manufactured `success:true` with an explanatory message, since this isn't an error.
- No `question.correctAnswer` on a UPSC exam type → non-retryable failure noting the paper has no answer key for this question, directing the operator to mark manually and Pass Step.
- No `question.correctAnswer` otherwise → generic non-retryable failure.
- Unrecognized answer letter → non-retryable failure.

**Key decision:** automates the per-option button, not the "Select Correct Answer" summary dropdown — the button is identical in every context (standalone or inside a Sub Question card), while the dropdown's control type differs by context (native `<select>` standalone vs. `<ng-select>` inside a group, confirmed live). The button was chosen specifically because its interaction shape doesn't depend on that context, keeping this state simple even now that Question Groups are implemented.

**Modality difference:** Modality uses `selectDropdown()` against a Correct Answer dropdown with a letter-to-value map. Docxsity has no such dropdown-based path at all — the per-option button is the only mechanism it automates.

---

## GENERATE_AI

**Purpose:** click "Generate with AI" and wait for generation to actually finish, not just for the click to register.

Sequence: click `button.qm-btn-generate-ai` → wait for it to gain `[disabled]` → wait for it to lose `[disabled]` (timeout `GENERATE_AI_TIMEOUT_MS = 30000`, longer than the default 10000ms elsewhere) → read the Explanation editor's content as a post-condition check.

**Completion signal:** the two-phase disabled/enabled wait, **plus** non-empty text read out of the Explanation `<app-rich-editor>`'s iframe body.

**Failure handling:**
- Click fails, or either wait phase times out → that step's own retryable failure (generic, DOM-selector-laden message — an accepted, not-yet-actioned polish item).
- Both waits succeed but the Explanation field reads empty → `retryable:true` failure: "AI generation finished, but the Explanation field is still empty. Check the target website manually, then use Pass Step to continue if this is expected."
- On any failure, `executeStep()` does not advance the session state — it stays `GENERATE_AI`, so Execute Step can retry or Pass Step can move on. This is a deliberate, confirmed-working design (see [decisions.md](decisions.md)), not a gap.

**Key decision:** the two-phase wait exists because the button was observed live to still read as enabled at 100ms after the click and only disabled by ~500ms — a single "wait until not disabled" check would have raced and resolved instantly. The AI model picker (`<app-multi-models>`) is deliberately never touched — it always defaults to "Default," confirmed live.

**Modality difference:** this is the most significant behavioral divergence between the two sites. Modality's `runGenerateAi()` is click-only — it clicks the button and returns success immediately, with no wait for completion and no verification that anything was generated. Docxsity's version waits for the full generation cycle and verifies its own effect. See [decisions.md](decisions.md) for why.

---

## ADD_TAGS

**Purpose:** write `question.subject` (parsed directly from the source document, never AI-inferred) into the Tags & Sub Tags input and click "+ Tag".

**Completion signal:** waits for a `<span class="tib-tag-pill">` carrying the exact subject text to appear — not the input clearing, not a fixed delay.

**Failure handling:** `question.subject` absent → manufactured `success:true`, "This question has no subject to tag — skipped." (not an error — some questions genuinely have no subject). Fill/click/pill-wait failures propagate as their own retryable failures.

**Key decision:** exactly one responsibility — transfers the subject into a single top-level tag. Never touches "+ Sub Tag" (no sub-tag data exists in the parsed Question Object) or "Remove" (destructive). See [decisions.md](decisions.md) for why this exists as its own state rather than folding into `GENERATE_AI`.

**Modality difference:** none noted as architecturally significant — both sites treat tagging as its own state.

---

## SAVE

**Purpose:** click "Save Question" and wait for the Add Question modal to close.

**Completion signal:** `waitForDisappear(addQuestionModal)`.

**Failure handling:** if the modal is still present after the wait times out, the modal element (still live and attached) is queried directly for `.qm-error` elements and their text is joined into an actionable message ("Could not save the question: Question text is required. …") instead of surfacing the generic timeout. If no validation errors are found either, the raw timeout failure is returned as-is.

**Key decision:** reading `.qm-error` only happens *after* the completion-signal wait has already failed — it's never the wait condition itself, only a way to make an otherwise-generic timeout actionable.

**Modality difference:** Modality's `runSave()` is click-only, same simplification as its `GENERATE_AI` — no wait for the modal to close and no validation-error reading. Docxsity's version verifies its own effect and surfaces real validation failures. Both sites now have a group-aware save path (only a group's last member reaches this state — see [Question Groups](#question-groups)); Docxsity's `runSave()` picks the correct modal to save via `question.group` (the group modal vs. the standalone modal) rather than via `resolveCurrentRoot()`, since that would resolve the wrong root (a sub-question card, not the group-wide Save button) for a grouped question.

---

## NEXT_QUESTION

**Purpose:** advance `Session` to the next question index. No DOM interaction.

**Completion signal:** always succeeds if there is a current question to advance from.

**Failure handling:** no current question → non-retryable failure (should not normally be reachable).

**Next state:** `PREPARE_FORM` if another question remains, otherwise `COMPLETE`.

---

## PASS STEP

Not a state — an operator control (`passStep()`) that skips the current state's DOM automation entirely, reports the same success message `executeStep()` would have shown for that state, and advances `Session` to whatever `determineNextState()` says comes next. Used to move past a state the operator has handled manually (e.g. a UPSC question with no answer key, or an image that needed manual insertion). Fully synchronous — no DOM waits, no `await` in its call chain.

## JUMP

Not a state — an operator control (`jumpToQuestion(rawInput)`) that validates the input as a positive integer within the loaded question range, sets `Session`'s current question index directly, and resets state to `PREPARE_FORM`. Docxsity's version now has the same group-redirect logic as Modality's (see [Question Groups](#question-groups)): jumping to any non-first group member redirects to that group's first question instead, since a Question Group can only be created sequentially starting from its first sub-question. Edge cases (all independently confirmed): jump to a group's first member → direct jump; jump to a middle or last member → redirect to first; a standalone question immediately before or after a group → unaffected, direct jump either way.

---

## Shared panel-wide protection

Both Execute Step, Pass Step, and Jump are gated by a single busy guard living in the shared `content/panel.js`, not in this state machine — see [architecture.md](architecture.md) for why that lives in shared code rather than being duplicated per site.
