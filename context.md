# EXAM_UPLOAD_ASSISTANT_CONTEXT.md

# Exam Upload Assistant

## Overview

This project builds a **private Chrome Extension** for my company's
internal website.

The extension assists with uploading large numbers of multiple-choice
questions into the Question Bank.

This is an **internal productivity tool** and is **not** intended for
public release.

------------------------------------------------------------------------

# Objective

Reduce repetitive manual work while keeping the user in full control.

The extension is a **Guided Browser Assistant**, not a fully autonomous
automation tool.

The user manually executes **one logical workflow state at a time**.
After each state completes, the extension stops and waits for user
verification.

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
Generate with AI
↓
Wait for AI completion
↓
Save Question
↓
Next Question
```

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

------------------------------------------------------------------------

# State Responsibilities

## PREPARE_FORM

-   Click Add Question
-   Select MCQ
-   Set Marks = 4
-   Set Penalty = 1

## PASTE_QUESTION

-   Open Markdown editor
-   Paste Question Markdown
-   Apply

## PASTE_OPTIONS

-   Paste Option A
-   Paste Option B
-   Paste Option C
-   Paste Option D

## MARK_CORRECT

-   Select the correct answer.

## GENERATE_AI

-   Click Generate with AI.
-   Wait for completion.
-   Verify success.

## SAVE

-   Save the question.
-   Verify creation.

## NEXT_QUESTION

-   Advance to the next parsed question.
-   If no questions remain, transition to COMPLETE instead of PREPARE_FORM.

------------------------------------------------------------------------

# Question Object

``` javascript
{
  question,
  options: { A, B, C, D },
  correctAnswer,
  marks: 4,
  penalty: 1,
  type: "MCQ"
}
```

------------------------------------------------------------------------

# Browser Automation Philosophy

Keep browser helpers generic:

-   clickElement()
-   waitForElement()
-   waitForDisappear()
-   setInputValue()
-   pasteMarkdown()
-   selectDropdown()

Business logic belongs in the state machine.

## Asynchronous Waiting Strategy

waitForElement() and waitForDisappear() use MutationObserver-based detection, not fixed-interval polling.

All waits have a bounded maximum timeout and return a failure result on timeout, consistent with the {success, message, retryable} contract.

------------------------------------------------------------------------

# Session State & Persistence

The mechanism for persisting session state (parsed questions, current index, current state) across page reloads or navigation is not yet decided.

The target website's actual navigation behavior (whether saving a question causes a full page reload or stays within a single-page app) will be inspected during early implementation phases, and the persistence strategy will be chosen based on those findings.

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

------------------------------------------------------------------------

# Development Philosophy

-   Build one phase at a time.
-   Explain before coding.
-   Implement only the current phase.
-   Test manually.
-   Stop after every phase.
-   Wait for approval before continuing.

------------------------------------------------------------------------

# Code Quality

Prioritize:

-   Reliability
-   Maintainability
-   Simplicity
-   Debuggability

Avoid `eval()`, runtime code generation, and dynamically fetched
JavaScript.
