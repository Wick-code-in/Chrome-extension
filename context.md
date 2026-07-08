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

If the current Question Object has `hasImage: true`, execution for
that question pauses before any browser interaction begins, and the
user is informed that manual image insertion is required before
continuing. See [Image Handling](#image-handling).

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
  questionNumber,
  questionMarkdown,
  type,
  options: { A, B, C, D },
  correctAnswer,
  hasImage: false,
  imageMarkdown: null,
  marks: 4,
  penalty: 1
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

Never use setTimeout(), setInterval(), sleep(), or await new Promise(...) to wait for the UI. Every wait resolves based on an observable condition (element exists, becomes visible, disappears, an attribute changes, a MutationObserver callback fires, or a Promise resolved by one of these).

All waits have a bounded maximum timeout, used only as a failure limit — never as the synchronization mechanism itself — and return a failure result on timeout, consistent with the {success, message, retryable} contract.

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
