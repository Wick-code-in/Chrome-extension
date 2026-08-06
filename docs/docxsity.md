# Docxsity State Flow

Target site: https://www.docxsity.com/. This document describes what each state in `sites/docxsity/stateMachine.js` does, how it knows it succeeded, how it fails, and anything intentionally different from the Modality implementation (`sites/modality/stateMachine.js`). For *why* these decisions were made, see [decisions.md](decisions.md) and [architecture.md](architecture.md).

State order: `IDLE → PREPARE_FORM → PASTE_QUESTION → PASTE_OPTIONS → MARK_CORRECT → GENERATE_AI → ADD_TAGS → SAVE → NEXT_QUESTION → (PREPARE_FORM | COMPLETE)`.

Fill Blank (`NUMERICAL`) questions skip `PASTE_OPTIONS` and `MARK_CORRECT` entirely — `determineNextState()` jumps straight from `PASTE_QUESTION` to `GENERATE_AI` for that type. See [decisions.md](decisions.md) for why.

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

**Modality difference:** Modality skips Penalty entirely for its non-MCQ type; Docxsity does not, because the field itself behaves differently on this site. Docxsity also has no Question Group branch in this state (Modality's `ensureQuestionFormReady` handles both a standalone question and a Sub Question card) — Docxsity's `runPrepareForm()` only ever prepares a standalone question.

---

## PASTE_QUESTION

**Purpose:** paste the question's markdown into the Question Text field via TinyMCE's "Paste Raw Markdown" → "Paste Markdown Data" import flow.

**Completion signal:** `pasteMarkdown()`'s wait for the import dialog to disappear after "Render & Insert" is clicked.

**Failure handling:** no `question.questionMarkdown` → non-retryable failure. Any step inside `pasteMarkdown()` (trigger click, dialog wait, textarea fill, confirm click, disappear wait) propagates its own retryable failure.

**Key decision:** the Add Question modal is re-resolved fresh via `waitForElement(addQuestionModal)` at the start of this state rather than reusing a reference from `PREPARE_FORM` — state handlers never carry DOM references between each other. Since the modal is already open, this settles near-instantly. The import dialog itself is looked up **unscoped** (document-wide, not scoped to the Add Question modal) because it is a TinyMCE-native dialog appended directly to `document.body`, confirmed live to not be a descendant of the modal.

**Modality difference:** Modality scopes this state's work to `resolveCurrentRoot(question)` — `document` for a standalone question, or a specific Sub Question card for a Question Group member — and distinguishes `question.questionOnlyMarkdown` from `question.questionMarkdown` for group members. Docxsity has no Question Group concept, so it always operates against `document` and always reads `question.questionMarkdown` directly.

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

**Key decision:** automates the per-option button, not the "Select Correct Answer" summary dropdown — the button is identical in every context, while the dropdown's control type differs by context (native `<select>` vs `<ng-select>`, confirmed live) and Question Groups aren't implemented anyway.

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

**Modality difference:** Modality's `runSave()` is click-only, same simplification as its `GENERATE_AI` — no wait for the modal to close and no validation-error reading. Docxsity's version verifies its own effect and surfaces real validation failures. Docxsity has no Question Group save path (Modality's Save behaves differently for the last member of a group) — every Docxsity save is a standalone Add Question save.

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

Not a state — an operator control (`jumpToQuestion(rawInput)`) that validates the input as a positive integer within the loaded question range, sets `Session`'s current question index directly, and resets state to `PREPARE_FORM`. Docxsity's version has no Question Group redirect logic (Modality's `jumpToQuestion()` redirects a jump into the middle of a group back to the group's first question) since Docxsity has no Question Groups to redirect around.

---

## Shared panel-wide protection

Both Execute Step, Pass Step, and Jump are gated by a single busy guard living in the shared `content/panel.js`, not in this state machine — see [architecture.md](architecture.md) for why that lives in shared code rather than being duplicated per site.
