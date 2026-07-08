# EXAM_UPLOAD_ASSISTANT_CONTEXT.md

# Exam Upload Assistant

## Status: Version 1 Complete

Version 1 is feature-complete and live-tested end to end, including across multiple consecutive questions. See [CHANGELOG.md](CHANGELOG.md) for the release entry and the Version 2 roadmap, and [architecture.md](architecture.md) for how it's built, including the major bugs encountered and solved along the way.

## Overview

This project builds a **private Chrome Extension** for my company's
internal website.

The extension assists with uploading large numbers of multiple-choice
questions into the Question Bank.

This is an **internal productivity tool** and is **not** intended for
public release.

------------------------------------------------------------------------

# Scope: Version 1 Is Text-Only

Version 1 handles text-only questions.

The extension does not upload, process, manage, or automate images in
any way.

If a question contains an image (Markdown image syntax `![](...)` or
an HTML `<img>` tag), the parser marks it with `hasImage: true` and
does not otherwise act on the image.

During execution, a question with `hasImage: true` pauses the guided
workflow and informs the user that manual image insertion is required
before continuing.

This keeps Version 1 reliable and focused on automating the repetitive
text-entry workflow.

------------------------------------------------------------------------

# Design Philosophy: No Fixed Exam Pattern

The extension must not assume a fixed exam pattern (for example, 20
MCQs and 5 Fill-in-the-Blank questions per subject).

Different years and subjects may have additional optional questions or
different section sizes.

The parser's responsibility is limited to extracting individual
questions from a Markdown file. It does not know about, validate, or
enforce subject, section, or exam-level structure such as question
counts.

Subject selection, question type selection, and (optionally) how many
questions belong to the current section are configuration choices made
by the user, through a future UI phase. This configuration does not
exist yet.

The current MCQ-only workflow and the `type: "MCQ"` field on the
Question Object reflect the scope approved so far and are expected to
become configurable in a later phase.

------------------------------------------------------------------------

# Objective

Reduce repetitive manual work while keeping the user in full control.

The extension is a **Guided Browser Assistant**, not a fully autonomous
automation tool.

The user manually executes **one logical workflow state at a time**.
After each state completes, the extension stops and waits for user
verification.

This is the project's core philosophy, and it shaped Version 1 concretely, not just as an aspiration:

- **Semi-automatic by design.** Execute Step performs one state and stops. It never chains multiple states together automatically.
- **The human remains in control.** No state runs unless the operator explicitly presses Execute Step.
- **Execute Step always represents a human decision.** This is most visible in `GENERATE_AI` and `SAVE`: both click their respective button and advance immediately, *without* waiting for or verifying the result — the next Execute Step press is the operator's explicit signal that they've reviewed the AI-generated explanation, or confirmed the save succeeded, and are ready to proceed. See [State Responsibilities](#state-responsibilities) below.
- **Images are inserted manually.** See [Image Handling](#image-handling).
- **Tags are inserted manually.** Version 1 does not read, select, or apply tags — this remains entirely the operator's responsibility, untouched by any state.
- **The AI-generated explanation is reviewed manually.** `GENERATE_AI` only clicks the button; the operator edits the result on the live site before the next Execute Step press moves on to `SAVE`.

------------------------------------------------------------------------

# Target Website

The extension runs only on:

``` text
https://aistudio-scrapper.blockverse.tech
```

No other websites should be affected.

------------------------------------------------------------------------

# Technology

-   Chrome Extension
-   Manifest V3
-   Vanilla JavaScript
-   No frameworks
-   No build system
-   No TypeScript

------------------------------------------------------------------------

# Workflow

``` text
Add Question
↓
Select MCQ
↓
Marks = 4
↓
Penalty = 1
↓
Paste Question Markdown
↓
Paste Options A–D
↓
Select Correct Option
↓
Generate with AI  ← Execute Step stops here; operator reviews/edits the explanation manually
↓
Save Question      ← Execute Step stops here; operator confirms the save manually
↓
Next Question
```

Each arrow is a separate Execute Step press. Nothing after "Generate with AI" or "Save Question" happens until the operator has verified the result and pressed Execute Step again — this is the semi-automatic behavior described in [Objective](#objective), not a temporary limitation.

------------------------------------------------------------------------

# State Machine

``` text
IDLE
↓
PREPARE_FORM
↓
PASTE_QUESTION
↓
PASTE_OPTIONS
↓
MARK_CORRECT
↓
GENERATE_AI
↓
SAVE
↓
NEXT_QUESTION
↓ (more questions remain) → PREPARE_FORM
↓ (no questions remain) → COMPLETE
```

Each Execute Step performs exactly one logical state and then stops.

COMPLETE is a terminal state reached when no questions remain.

Every state validates its own preconditions before acting, and returns a failure result if they are not met.

Every state transition is logged for debugging.

If the current Question Object has `hasImage: true`, execution for
that question pauses before any browser interaction begins, and the
user is informed that manual image insertion is required before
continuing. See [Image Handling](#image-handling).

------------------------------------------------------------------------

# State Responsibilities

Every state below is implemented and live-tested. See [architecture.md](architecture.md) for how each one interacts with the DOM.

## PREPARE_FORM

-   Click Add Question.
-   Select MCQ (Question Type dropdown).
-   Set Marks = 4.
-   Set Penalty = 1.

## PASTE_QUESTION

-   Open the Markdown import modal via the Question field's "Paste Raw Markdown" button.
-   Paste the question's markdown, unmodified, into the modal's textarea.
-   Confirm ("Render & Insert").

## PASTE_OPTIONS

-   Paste Option A.
-   Paste Option B.
-   Paste Option C.
-   Paste Option D.

Each option is pasted via the same Markdown import modal workflow as PASTE_QUESTION, in sequence, stopping at the first option that fails.

## MARK_CORRECT

-   Read the Question Object's `correctAnswer`.
-   Select that option in the "Select Correct Answer" dropdown.

## GENERATE_AI

-   Click "Generate with AI."
-   Advance immediately.

Does **not** wait for generation to finish, inspect the explanation editor, or verify the result — this is an explicit human-in-the-loop checkpoint. The operator reviews and edits the generated explanation manually before pressing Execute Step again to proceed to SAVE. See [Objective](#objective).

## SAVE

-   Click "Save Question."
-   Advance immediately.

Does **not** wait for a dialog to close, wait for the question bank to refresh, or verify question creation — another explicit human-in-the-loop checkpoint. The operator manually verifies the question was saved before pressing Execute Step again to proceed to NEXT_QUESTION.

## NEXT_QUESTION

-   Advance to the next parsed question.
-   If no questions remain, transition to COMPLETE instead of PREPARE_FORM.

------------------------------------------------------------------------

# Question Object

``` javascript
{
  questionNumber,
  questionMarkdown,
  type,
  options: { A, B, C, D },
  correctAnswer,
  hasImage: false,
  imageMarkdown: null
}
```

`questionMarkdown` is the original markdown of the question block,
preserved exactly as written, except for the structured fields
extracted from it.

`options` is present only for question types that have discrete
options (e.g., MCQ). Other question types may omit it.

`hasImage` is `true` when the parser detects Markdown image syntax
`![](...)` or an HTML `<img>` tag in the question block. When
detected, the matched image markdown is captured in `imageMarkdown`;
otherwise it is `null`. The parser only detects presence — it does not
strip, transform, upload, or otherwise act on image content.

The parser extracts individual questions only. It has no concept of
subject, section, or exam-level structure, and does not validate or
enforce question counts. See
[Design Philosophy: No Fixed Exam Pattern](#design-philosophy-no-fixed-exam-pattern).

Marks (4) and Penalty (1) are **not** part of the Question Object — they are fixed values applied by `PREPARE_FORM` itself (`PREPARE_FORM_MARKS_VALUE`, `PREPARE_FORM_PENALTY_VALUE` in `lib/stateMachine.js`), not data parsed from the markdown.

------------------------------------------------------------------------

# Parsing Strategy

The parser is block-based, not line-based.

Each numbered question is treated as one complete block, extending
from its number until the next numbered question or the end of the
file.

The parser extracts structured fields from each block and preserves
the block's original markdown exactly, aside from that extraction.

The parser only identifies question boundaries and extracts the
required fields. It must not otherwise alter the markdown. Specifically,
it must not normalize whitespace, reformat markdown, rewrite equations,
modify LaTeX, change bullet points, or trim internal blank lines. The
exact original markdown of each extracted field must remain available,
unmodified, for later pasting.

The parser must never depend on subjects, sections, or fixed question
counts, and must work correctly for any number of questions.

------------------------------------------------------------------------

# Image Handling

Version 1 is text-only. Image upload, processing, and automation are
out of scope.

When a Question Object has `hasImage: true`, the guided workflow
pauses before performing any browser interaction for that question and
informs the user that manual image insertion is required.

The user manually inserts the image directly on the target website,
then resumes the guided workflow via the existing Execute Step flow.

------------------------------------------------------------------------

# Browser Automation Philosophy

Keep browser helpers generic. The implemented helpers, in `lib/domHelpers.js`:

-   `findElement()`
-   `isVisible()`
-   `waitForElement()`
-   `waitForDisappear()`
-   `clickElement()`
-   `fillInput()`
-   `pasteMarkdown()`
-   `selectDropdown()`

Business logic belongs in the state machine. `domHelpers.js` never contains a target-site selector or any knowledge of what a "Question" or "Marks field" is — see [architecture.md](architecture.md) for the selector-descriptor system that keeps this separation real rather than aspirational.

## Asynchronous Waiting Strategy

waitForElement() and waitForDisappear() use MutationObserver-based detection, not fixed-interval polling.

Never use setTimeout(), setInterval(), sleep(), or await new Promise(...) to wait for the UI. Every wait resolves based on an observable condition (element exists, becomes visible, disappears, an attribute changes, a MutationObserver callback fires, or a Promise resolved by one of these).

All waits have a bounded maximum timeout, used only as a failure limit — never as the synchronization mechanism itself — and return a failure result on timeout, consistent with the {success, message, retryable} contract.

------------------------------------------------------------------------

# Session State & Persistence

Decided (Version 1): session state (parsed questions, current index, current state) lives in memory only, in `lib/session.js`. It does **not** persist across a page reload or navigation — reloading the page resets the session entirely, and the operator must re-load the Markdown file and restart from Question 1.

This was an intentional Version 1 scope boundary, not an oversight: the target website's navigation behavior (no full page reload occurs during the normal Add Question → Save Question flow) meant persistence was never required for a single uninterrupted session, and building it prematurely would have added complexity before it was known to be needed.

Resuming an interrupted session, jumping to an arbitrary question, and recovering from a crash are Version 2 scope. See [CHANGELOG.md](CHANGELOG.md#roadmap--version-2).

------------------------------------------------------------------------

# Error Handling

Each state validates its own preconditions before acting, and returns `success: false` if they are not met, rather than attempting the action blindly.

Each state returns:

``` javascript
{
  success,
  message,
  retryable
}
```

Advance only when `success == true`.

Every state transition is logged (state name and result) for debugging purposes.

Version 1's only recovery mechanism is implicit: because a failed state never advances, pressing Execute Step again retries the same state. There is no explicit Skip or Abort control yet — that is Version 2 scope. See [CHANGELOG.md](CHANGELOG.md#roadmap--version-2).

------------------------------------------------------------------------

# Development Philosophy

-   Build one phase at a time.
-   Explain before coding.
-   Implement only the current phase.
-   Test manually.
-   Stop after every phase.
-   Wait for approval before continuing.

This discipline was followed for the entire Version 1 build (see [Implementation.md](Implementation.md) for the phase-by-phase record) and continues to apply to Version 2 development.

------------------------------------------------------------------------

# Code Quality

Prioritize:

-   Reliability
-   Maintainability
-   Simplicity
-   Debuggability

Avoid `eval()`, runtime code generation, and dynamically fetched
JavaScript.
