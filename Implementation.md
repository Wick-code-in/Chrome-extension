# Implementation Plan

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

# Phase 1 — Chrome Extension Skeleton

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

---

# Phase 2 — Assistant UI

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

---

# Phase 3 — Markdown Loader

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

---

# Phase 4 — Markdown Parser

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

---

# Phase 5 — State Machine

## Objective

Implement the guided workflow.

## Deliverables

- lib/stateMachine.js

## States

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

↓ (more questions remain)

PREPARE_FORM

↓ (no questions remain)

COMPLETE

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

---

# Phase 6 — Browser Helpers

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

Every wait must have a bounded maximum timeout.

On timeout, the helper must return a failure result consistent with the state machine's {success, message, retryable} contract rather than throwing or hanging indefinitely.

Browser helpers must remain generic.

No business logic.

---

# Phase 7 — Prepare Form

Implement

PREPARE_FORM

Responsibilities

- Click Add Question
- Select MCQ
- Set Marks = 4
- Set Penalty = 1

Stop.

---

# Phase 8 — Paste Question

Implement

PASTE_QUESTION

Responsibilities

- Open Markdown dialog
- Paste Question Markdown
- Apply

Stop.

---

# Phase 9 — Paste Options

Implement

PASTE_OPTIONS

Responsibilities

Paste

- Option A
- Option B
- Option C
- Option D

Stop.

---

# Phase 10 — Mark Correct

Implement

MARK_CORRECT

Responsibilities

Read the Question Object.

Select the correct option.

Stop.

---

# Phase 11 — Generate AI

Implement

GENERATE_AI

Responsibilities

- Click Generate with AI.
- Wait for AI generation.
- Verify completion.

Stop.

Advance only after successful generation.

---

# Phase 12 — Save

Implement

SAVE

Responsibilities

- Click Save.
- Wait for dialog to close.
- Verify question creation.

Stop.

---

# Phase 13 — Next Question

Implement

NEXT_QUESTION

Responsibilities

- Advance parser pointer.
- Update progress.
- If questions remain, return to PREPARE_FORM.
- If no questions remain, transition to COMPLETE.

---

# Phase 14 — Progress

Display

- Current Question
- Progress
- Current State
- Estimated Remaining Time

---

# Phase 15 — Error Handling

Implement

- Retry
- Skip
- Abort

Never continue silently.

Errors must always be visible to the user.

---

# Phase 16 — Polish

Implement

- Session persistence
- Resume after interruption
- Keyboard shortcut
- Optional dark mode

The persistence mechanism for session state will be selected based on the target website's actual navigation behavior, as observed during earlier phases — not decided in advance.

---

# Completion Criteria

The project is complete when:

- All phases have been implemented.
- Every phase has been manually tested.
- Every phase has been approved.
- The extension reliably uploads multiple questions using the guided workflow.

The project should prioritize:

- Reliability
- Maintainability
- Simplicity
- Debuggability

Speed of implementation is less important than correctness.