# Implementation Plan

## Status: Version 1 Complete

All phases required for a working, semi-automatic, live-tested guided upload workflow (Phases 1–13) are complete. Phase 14 is partially complete. Phases 15–16, as originally scoped below, were not built in Version 1 — their essential parts are carried forward into the Version 2 roadmap in [CHANGELOG.md](CHANGELOG.md#roadmap--version-2). See that file for the full release entry, and [architecture.md](architecture.md) for how the system is actually built, including the major bugs encountered and solved along the way.

## Project Goal

Build a private Chrome Extension (Manifest V3) that assists with uploading multiple-choice questions to the company's internal website.

The extension is a **Guided Browser Assistant**.

It is **not** a fully autonomous automation tool.

The user manually executes one logical workflow state at a time.

After every state completes, the extension stops and waits for user verification.

---

# Scope: Version 1 Is Text-Only

Version 1 of this extension handles text-only questions.

The extension does not upload, process, manage, or automate images in any way.

If a parsed question contains an image (Markdown image syntax `![](...)` or an HTML `<img>` tag), the parser marks it with `hasImage: true` on the Question Object. It does not attempt to interpret, transform, or act on the image itself.

During execution, a question with `hasImage: true` causes the assistant to pause and inform the user that manual image insertion is required on the target website before continuing. The user inserts the image manually, then resumes the guided workflow.

This is an intentional scope decision to keep Version 1 reliable and focused on automating the repetitive text-entry workflow.

---

# Design Philosophy: No Fixed Exam Pattern

The extension must not assume a fixed exam pattern (for example, a fixed number of MCQs or Fill-in-the-Blank questions per subject).

Different years and subjects may have different section sizes, additional optional questions, or different question type distributions.

The parser's responsibility is limited to extracting individual questions from a Markdown file. It does not know about, validate, or enforce subject, section, or exam-level structure such as question counts.

Subject selection, question type selection, and (optionally) how many questions belong to the current section are configuration choices made by the user, through a future UI phase. This configuration does not exist yet and is not part of any currently approved phase.

The current MCQ-only workflow (Phases 4–13, and the `type: "MCQ"` field on the Question Object) reflects the scope approved so far. It is expected to become configurable in a later phase and must not be treated as a permanent structural assumption.

---

# Development Philosophy

This project is implemented incrementally.

Each phase must be completed, tested, and approved before moving to the next phase.

Never implement multiple phases together.

Never skip a phase.

Never scaffold files or functionality for future phases.

This discipline was followed for every phase below and continues to apply to Version 2 development.

---

# Development Workflow

Every implementation session must follow this workflow.

1. Explain the phase.
2. Explain the implementation approach.
3. Implement only the requested phase.
4. Modify only the files required for that phase.
5. Explain every file that was created or modified.
6. Provide a manual testing checklist.
7. Stop and wait for approval.

Do not automatically continue to the next phase.

---

# Phase 1 — Chrome Extension Skeleton — ✅ Complete

## Objective

Create the minimum working Chrome Extension.

## Deliverables

- manifest.json
- content/content.js

## Requirements

- Manifest V3
- Runs only on the target website
- Inject a Shadow DOM root
- Display a simple "Hello World" panel
- No future files
- No UI framework

## Success Criteria

- Extension loads successfully.
- Panel appears only on the target website.
- Panel does not appear elsewhere.
- Reloading the page does not create duplicates.

**As built:** `content/content.js` injects a single Shadow DOM host (guarded against duplicate injection by checking for an existing host id), waiting for `document.body` via a `MutationObserver` before injecting.

---

# Phase 2 — Assistant UI — ✅ Complete

## Objective

Replace the placeholder panel with a proper assistant interface.

## Deliverables

- content/panel.js
- content/panel.css

Modify

- content/content.js

## Requirements

Display

- Question Index
- Current Step
- Execute Step button
- Progress Bar

The panel must be draggable.

The Execute Step button only logs to the console.

No automation.

No parser.

No browser interaction.

## Success Criteria

- Panel is draggable.
- Execute Step logs correctly.
- Layout remains stable.

**As built:** `content/panel.js` renders the panel (question counter, current state, status message, progress bar, Execute Step, Load Markdown), and implements dragging via mouse event listeners on the header. Execute Step's console-only behavior was later wired to the real state machine (Phase 5/6) as planned — this phase's scope was UI-only.

---

# Phase 3 — Markdown Loader — ✅ Complete

## Objective

Load a local Markdown file.

## Deliverables

Modify

- panel.js

## Requirements

- Load Markdown file
- Read text
- Store in memory
- Display

Loaded

Pending Parse

No parsing.

No browser automation.

The persistence strategy for this in-memory state (e.g., whether it must survive a page reload) is not yet decided. The target website's actual navigation behavior will be inspected during this and later phases before any persistence mechanism is chosen.

## Success Criteria

Markdown loads successfully.

**As built:** file loading was implemented in `content/loader.js` (not `panel.js` directly), exposing a small public API (`openFilePicker`, `getRawMarkdown`, `getFilename`, `hasFileLoaded`) that the panel consumes — this kept the panel a pure view/wiring layer rather than owning file-reading logic itself. The persistence question raised here was ultimately decided during Phase 16 planning: no persistence in Version 1. See [context.md](context.md#session-state--persistence).

---

# Phase 4 — Markdown Parser — ✅ Complete

## Objective

Convert Markdown into Question Objects.

## Deliverables

- lib/parser.js

## Parsing Strategy

The parser is block-based, not line-based.

Each numbered question is treated as one complete block, extending from its number until the next numbered question or the end of the file.

The parser preserves the original markdown of each block exactly, except for the structured fields it extracts from it.

## Exact Preservation

The parser only identifies question boundaries and extracts the required fields. It must not otherwise alter the markdown in any way.

Specifically, the parser must not:

- Normalize whitespace.
- Reformat markdown.
- Rewrite equations.
- Modify LaTeX.
- Change bullet points.
- Trim internal blank lines.

The exact original markdown of each extracted field must remain available, unmodified, for later pasting.

## Requirements

For each block, extract

- question number
- question markdown
- question type
- options (if present)
- correct answer
- hasImage
- imageMarkdown (if any)

Ignore everything after

**Solution:**

Support

- Multiple questions

Detect (do not process)

- Markdown image syntax `![](...)`
- HTML `<img>` tags

When either is detected in a question, set `hasImage: true` and capture the matched image markdown in `imageMarkdown`. The parser does not strip, transform, upload, or otherwise act on image content — detection only.

The parser must never depend on subjects, sections, or fixed question counts. It must work for any number of questions. It has no concept of a fixed exam pattern.

Parser must be completely independent of browser automation.

## Success Criteria

Correct Question Objects are produced for any number of questions, regardless of subject or section structure.

**As built:** matches the real sample format discovered via `samples/jee-main-pyq.md` — question markers `**N.**`, options `(1)`–`(4)`, answer marker `Ans. (N)`. Implemented as a decomposed pipeline (boundary-finding → answer-splitting → option-splitting → image detection → type determination) rather than one large regex, to keep each concern independently testable. See [context.md](context.md#question-object) for the exact shape produced (note: `marks`/`penalty` are *not* part of the Question Object — they're fixed values applied in `PREPARE_FORM`).

---

# Phase 5 — State Machine — ✅ Complete

## Objective

Implement the guided workflow.

## Deliverables

- lib/stateMachine.js

## States

IDLE → PREPARE_FORM → PASTE_QUESTION → PASTE_OPTIONS → MARK_CORRECT → GENERATE_AI → SAVE → NEXT_QUESTION → (more questions remain) PREPARE_FORM / (no questions remain) COMPLETE

## Requirements

Each Execute Step performs exactly one logical state.

Before performing its action, every state must validate that its expected preconditions are met. If preconditions are not met, the state must return a failure result rather than attempting the action.

Every state returns

```javascript
{
    success,
    message,
    retryable
}
```

Advance only when

```javascript
success == true
```

Every state transition must be logged (state name and result) for debugging. Logging is lightweight console output and does not require persistent storage.

COMPLETE is a terminal state. NEXT_QUESTION transitions to COMPLETE when no questions remain, otherwise it transitions back to PREPARE_FORM.

If the current Question Object has `hasImage: true`, execution for that question must pause before any browser interaction begins, and the user must be informed that manual image insertion is required before continuing. The user inserts the image manually on the target website, then resumes the guided workflow via the existing Execute Step flow.

No browser interaction yet.

**As built:** at this phase, all states except IDLE and NEXT_QUESTION/COMPLETE were stub handlers (`makeStubHandler`) that validated preconditions and returned success without touching the DOM — real browser automation was added state-by-state in Phases 7–12. `lib/session.js` (a single source of truth for raw markdown, parsed questions, current index, current state) was introduced alongside this phase so the state machine, panel, and loader could all read/write session data through one consistent API rather than each other's internals.

---

# Phase 6 — Browser Helpers — ✅ Complete

## Objective

Create reusable browser interaction utilities.

## Deliverables

- lib/domHelpers.js
- lib/selectors.js

## Helpers

- waitForElement()
- waitForDisappear()
- clickElement()
- fillInput()
- pasteMarkdown()
- selectDropdown()

## Asynchronous Waiting Strategy

waitForElement() and waitForDisappear() must use MutationObserver-based detection rather than fixed-interval polling.

Never use setTimeout(), setInterval(), sleep(), or await new Promise(...) to wait for the UI. Every wait must resolve based on an observable condition: an element existing, becoming visible, disappearing, an attribute changing, a MutationObserver callback firing, or a Promise resolved by one of these DOM changes.

Every wait must have a bounded maximum timeout. The timeout exists only as a failure limit — the point at which the helper gives up and reports a timeout error — never as the mechanism used to detect success.

On timeout, the helper must return a failure result consistent with the state machine's {success, message, retryable} contract rather than throwing or hanging indefinitely.

Browser helpers must remain generic.

No business logic.

**As built:** `lib/selectors.js` was created in this phase (with placeholder values, verified selector-by-selector in later phases) rather than deferred, so every later phase had one consistent place to write selectors into from the start. `findElement()` also supports selector *descriptors* (not just CSS strings) — see [architecture.md](architecture.md#the-selector-descriptor-system) — added incrementally as later phases encountered elements with no stable CSS-addressable attribute. Both `waitForElement()`/`waitForDisappear()` observe `document.documentElement` rather than the caller's `root`, for robustness against the framework replacing `root` wholesale — see [architecture.md](architecture.md#waiting-strategy-mutationobserver-only).

---

# Phase 7 — Prepare Form — ✅ Complete

Implement

PREPARE_FORM

Responsibilities

- Click Add Question
- Select MCQ
- Set Marks = 4
- Set Penalty = 1

Stop.

**As built:** all four selectors verified via live HTML inspection before implementation. The Marks field's own appearance is used as the "form is ready" signal (no separate dialog-wrapper selector needed). The Question Type dropdown's selector was later revised — see [architecture.md](architecture.md#2-question-type-selector-collision-after-the-first-question-is-saved-post-phase-12) for the multi-question collision bug this phase's original selector caused, discovered and fixed after Phase 12.

---

# Phase 8 — Paste Question — ✅ Complete

Implement

PASTE_QUESTION

Responsibilities

- Open Markdown dialog
- Paste Question Markdown
- Apply

Stop.

**As built:** discovered during this phase that rich-text fields must be populated through the site's own "Paste Markdown Data" import modal, not by manipulating the TinyMCE editor directly. This produced `DomHelpers.pasteMarkdown()` — a single reusable helper encapsulating the full click-trigger → wait-for-modal → fill-textarea → confirm → wait-for-disappear sequence, reused unchanged by PASTE_OPTIONS. See [architecture.md](architecture.md#pastemarkdown-one-reusable-workflow-not-a-per-field-copy).

---

# Phase 9 — Paste Options — ✅ Complete

Implement

PASTE_OPTIONS

Responsibilities

Paste

- Option A
- Option B
- Option C
- Option D

Stop.

**As built:** implemented as a loop over `["A", "B", "C", "D"]`, calling `pasteMarkdown()` once per letter — no duplicated modal-handling logic. Live inspection revealed each Option's label and its editor's toolbar button are two DOM levels apart (not siblings, unlike Question), which required generalizing `findByLabelText()` into a bounded ancestor walk. See [architecture.md](architecture.md#1-option-editor-ancestor-scoping-phase-9) for the full bug writeup.

---

# Phase 10 — Mark Correct — ✅ Complete

Implement

MARK_CORRECT

Responsibilities

Read the Question Object.

Select the correct option.

Stop.

**As built:** uses the "Select Correct Answer" dropdown (a single native `<select>`, 0-indexed value per option) rather than the per-option "Mark as Correct" buttons — chosen for simplicity, since the dropdown's label and control are direct siblings requiring no ancestor-walk scoping, matching the Marks/Penalty pattern.

---

# Phase 11 — Generate AI — ✅ Complete (scope revised)

Implement

GENERATE_AI

**Original responsibilities (superseded):**

- Click Generate with AI.
- ~~Wait for AI generation.~~
- ~~Verify completion.~~

**As built (revised scope):** click "Generate with AI" and advance immediately — no waiting, no polling, no spinner detection, no explanation-editor inspection. This was an explicit, deliberate scope revision, not a shortfall: the extension is semi-automatic by design, and the operator reviews and edits the AI-generated explanation manually before pressing Execute Step again to proceed to SAVE. See [context.md](context.md#objective). `clickElement()` also gained a disabled-element check during this phase, since the button carries conditional `disabled:*` styling on the live site.

---

# Phase 12 — Save — ✅ Complete (scope revised)

Implement

SAVE

**Original responsibilities (superseded):**

- Click Save.
- ~~Wait for dialog to close.~~
- ~~Verify question creation.~~

**As built (revised scope):** click "Save Question" and advance immediately — no waiting for the dialog to close, no waiting for the question bank to refresh, no verification. Same rationale as Phase 11: the operator manually verifies the save before proceeding. This phase's live testing is what surfaced the Question Type selector collision bug — see [architecture.md](architecture.md#2-question-type-selector-collision-after-the-first-question-is-saved-post-phase-12).

---

# Phase 13 — Next Question — ✅ Complete

Implement

NEXT_QUESTION

Responsibilities

- Advance parser pointer.
- ~~Update progress.~~
- If questions remain, return to PREPARE_FORM.
- If no questions remain, transition to COMPLETE.

**As built:** implemented alongside Phase 5, since it requires only pure session-index logic and no browser interaction — `Session.advanceToNextQuestion()` plus a check of `Session.hasCurrentQuestion()` to choose between `PREPARE_FORM` and `COMPLETE`. Progress *display* (question counter, progress bar) is handled by the panel reading session state after every Execute Step, not by this state itself — see Phase 14.

---

# Phase 14 — Progress — ⚠️ Partially Complete

Display

- Current Question
- Progress
- Current State
- ~~Estimated Remaining Time~~

**As built:** the panel displays the question counter (`N / total`), current state, status message, and a percentage-based progress bar, updated after every Execute Step press by reading `Session.getCurrentQuestionIndex()` / `Session.getTotalQuestions()`. Estimated Remaining Time was not implemented and is not part of the Version 2 roadmap — dropped rather than deferred.

---

# Phase 15 — Error Handling — Not implemented in Version 1

Originally planned: explicit Retry / Skip / Abort controls, with errors never continuing silently and always visible to the user.

**As built:** errors are always visible (every state's `{success, message, retryable}` result is shown in the panel's status line, and a failed state never advances), which satisfies "never continue silently" — but there is no explicit Skip or Abort UI control. The only recovery path today is implicit: press Execute Step again to retry the same state. Explicit **Skip Question** is carried forward into the Version 2 roadmap. See [CHANGELOG.md](CHANGELOG.md#roadmap--version-2).

---

# Phase 16 — Polish — Not implemented in Version 1

Originally planned: session persistence, resume after interruption, keyboard shortcut, optional dark mode.

**As built:** none of this was implemented in Version 1 — session state lives in memory only and does not survive a page reload (see [context.md](context.md#session-state--persistence)). Session persistence and resume are carried forward as **Resume support** and **Crash/session recovery** in the Version 2 roadmap, alongside the newly-agreed **Jump to Question**. Keyboard shortcuts and dark mode are not part of the agreed Version 2 scope. See [CHANGELOG.md](CHANGELOG.md#roadmap--version-2).

---

# Completion Criteria

The project (Version 1) is complete:

- ✅ All phases required for a working guided workflow (1–13) have been implemented.
- ✅ Every implemented phase has been manually tested, including live testing on the real target site.
- ✅ Every implemented phase has been approved.
- ✅ The extension reliably uploads multiple questions using the guided workflow — live-verified across six consecutive questions after the Question Type selector fix.

The project prioritized, throughout:

- Reliability
- Maintainability
- Simplicity
- Debuggability

Speed of implementation was treated as less important than correctness — reflected in the practice of live-inspecting real HTML before writing any selector, and instrumenting rather than guessing when a live bug was reported.

See [CHANGELOG.md](CHANGELOG.md) for the Version 2 roadmap.
