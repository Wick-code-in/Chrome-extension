# Implementation Plan

## Project Goal

Build a private Chrome Extension (Manifest V3) that assists with uploading multiple-choice questions to the company's internal website.

The extension is a **Guided Browser Assistant**.

It is **not** a fully autonomous automation tool.

The user manually executes one logical workflow state at a time.

After every state completes, the extension stops and waits for user verification.

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

## Requirements

Parse

- Question
- Option A
- Option B
- Option C
- Option D
- Correct Answer

Ignore everything after

**Solution:**

Support

- Images
- Formatting
- Multiple questions

Parser must be completely independent of browser automation.

## Success Criteria

Correct Question Objects are produced.

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