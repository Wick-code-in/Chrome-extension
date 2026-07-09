# Version 2 Implementation Plan

## Purpose

Version 2 focuses on improving usability, recovery, and supporting multiple JEE question formats.

Unlike Version 1, Version 2 does not attempt to automate more decisions.

Instead, it improves the operator experience while preserving the semi-automatic philosophy established in Version 1.

---

## Design Philosophy

The human remains in control.

The extension automates repetitive work.

The extension should never attempt to infer user intent.

Recovery should always be explicit and initiated by the user.

Version 2 should add convenience without increasing unnecessary complexity.

The extension is deterministic. It never infers user intent or overrides operator decisions. Every action is explicit and initiated by the operator.

The operator is always in control. The extension executes commands; it never makes decisions on the operator's behalf.

---

## Goals

1. Prevent soft-lock situations.
2. Recover easily from browser crashes or reloads.
3. Reduce repetitive work when uploading numerical questions.
4. Preserve the existing Version 1 workflow.

---

## Scope

Version 2 contains three major phases.

Phase 1
Manual Pass Step

Phase 2
Jump to Question

Phase 3
Automatic Numerical Question Support

# Phase 1 — Pass Step

Purpose

Skip exactly one Execute Step by advancing the state pointer, without executing the current state's handler.

Philosophy

- Pass Step skips exactly one Execute Step.
- It advances the current state pointer without executing the current state's handler.
- It never performs DOM interaction.
- It never performs website automation.
- It never executes a state handler.
- It intentionally remains deterministic.
- It is available in every state.
- It performs exactly one piece of internal bookkeeping: when skipping past NEXT_QUESTION, it calls the same `Session.advanceToNextQuestion()` the NEXT_QUESTION handler performs, so the session's current-question pointer stays consistent with the displayed state pointer. This is bookkeeping, not automation — it involves no DOM interaction, no handler execution, and no website interaction. It is the only state-dependent behavior Pass Step has; every other transition is handled uniformly through the existing NEXT_STATE transition.
- This philosophy intentionally keeps Pass Step symmetric with a possible future Back feature, where both operations simply move the state pointer without executing handlers (a future Back over NEXT_QUESTION would need the mirrored bookkeeping exception).
- Pass Step requires an active parsed session (a loaded, parsed question set), the same prerequisite Execute Step already relies on. If no session is loaded, Pass Step fails gracefully: it does not advance the state, and it returns a status message such as "No question set loaded." This is the only prerequisite check Pass Step performs — it is not recovery logic, and it does not distinguish between states.

Examples of when an operator might use it

- Save Question clicked manually.
- Generate AI clicked manually.
- Any future manual action that advances the website without advancing the extension.

Implementation Goals

- Add a Pass Step button.
- Manual only.
- Never interacts with the website.
- Never performs DOM operations.
- Never performs state-specific logic.
- Advance exactly one state using the existing NEXT_STATE transition.
- COMPLETE remains terminal.

Success Criteria

The operator can skip exactly one Execute Step without reloading the extension.

# Phase 2 — Jump to Question

Purpose

Recover quickly after browser crashes, page reloads, or any situation where the extension needs to resume from a later question, by directly repointing the extension's tracked question and workflow state.

Jump is NOT an automation feature. The website remains entirely under operator control.

Philosophy

- Jump follows the same philosophy as Pass Step: the operator is always in control, and the extension executes commands rather than inferring intent.
- Jump changes the extension's internal bookkeeping only — the current-question pointer and the current workflow state.
- Jump always establishes a deterministic starting point by resetting the workflow to PREPARE_FORM, regardless of the previous state.
- Jumping to the question the extension is already on is valid and intentional — it provides a quick way to restart the current question's workflow (reset to PREPARE_FORM) without changing the tracked question.
- Jump must never click anything on the website, open the Add Question dialog, perform any DOM interaction, execute any state handler, or attempt to restore website state.
- Jump never guesses what the operator has already done on the website — including whether a question has already been uploaded. Jumping backward to an already-uploaded question is allowed and is the operator's responsibility, not a bug.

What Jump does

- Changes the extension's current question pointer to the requested question.
- Resets the workflow state to PREPARE_FORM.
- Refreshes the panel (question counter, progress, current state, status).

Implementation Goals

Allow jumping directly to any question contained in the currently loaded markdown file.

Validation

Jump requires an active loaded markdown session. If no session is loaded, Jump fails gracefully with no state change.

Jump accepts only positive integers. Leading zeros are accepted as an alternate textual representation of the same integer (e.g. "038" and "00038" both mean 38) — this is not fuzzy parsing, it is exact digit-string normalization. Jump rejects:

- empty input
- non-numeric input
- decimal numbers
- mixed strings (e.g. "38abc")
- zero
- negative numbers
- question numbers that do not exist in the currently loaded markdown file

There is no hardcoded upper limit — the valid range is bounded only by the number of questions in the currently loaded file.

On validation failure, the extension makes no state change, and the operator's input is left untouched so it can be corrected. On success, the input field is cleared.

Success Criteria

The operator can continue uploading from any question without restarting from Question 1.

# Phase 3 — Numerical Question Support

Phase 3 introduces support for Numerical (Fill Blank) questions.

The implementation is intentionally split into two independent sub-phases: parser classification (3A) and workflow branching (3B). Parser classification belongs entirely in Phase 3A. Workflow branching belongs entirely in Phase 3B. Phase 3 extends the existing architecture rather than duplicating it, and the MCQ implementation must remain as untouched as possible — the existing Version 1 workflow continues functioning exactly as before for MCQ questions.

## Phase 3A — Parser Classification

Responsibility

The parser determines the type of every question while parsing the markdown.

The markdown already contains section markers (for example Section A and Section B). Those section markers are the single source of truth.

The parser must:

- Detect when a section changes.
- Track the current section while parsing.
- Assign a type to every parsed question.

Example:

```text
Section A

Q1
Q2
Q3

Section B

Q4
Q5
Q6
```

becomes

```text
Question 1
type = MCQ

Question 2
type = MCQ

Question 3
type = MCQ

Question 4
type = NUMERICAL

Question 5
type = NUMERICAL

Question 6
type = NUMERICAL
```

There must never be any hardcoded question counts or assumptions such as "Section A always contains 25 questions." The parser simply follows the markdown.

The parser classifies each question once during parsing. That classification becomes part of the parsed Question object and travels with it for the remainder of the application's lifetime.

After parsing completes, no other component should need to know anything about sections. Sections are a parser concern only.

No automation changes happen during Phase 3A. The state machine remains completely untouched.

## Phase 3B — Numerical Workflow

Responsibility

The state machine reads the current question's type and performs the appropriate workflow.

The parser decides **what** a question is.

The state machine decides **how** to process it.

The state machine must never infer section boundaries or count questions. It simply reads the current Question object's type.

### MCQ Workflow

```text
PREPARE_FORM
↓
Question Type = MCQ Choice
↓
Marks = 4
↓
Penalty = 1
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
```

This workflow remains unchanged.

### Numerical Workflow

```text
PREPARE_FORM
↓
Question Type = Fill Blank
↓
Marks = 4
↓
Leave Penalty Empty
↓
PASTE_QUESTION
↓
Skip PASTE_OPTIONS
↓
Skip MARK_CORRECT
↓
GENERATE_AI
↓
SAVE
```

Notes

- Question Type must use the existing dropdown option with value `fill_blank`.
- Marks remain `4`.
- Penalty is optional on the website.
- The extension must intentionally leave the penalty field untouched.
- The extension must never type `0`, `N/A`, or any placeholder into Penalty.
- The extension does **not** interact with the "+ Add Blank" button.
- The extension continues to paste Markdown exactly as it already does.
- Generate AI remains unchanged.
- Save remains unchanged.

## Phase 3 Design Philosophy

The parser decides **what** the current question is.

The state machine decides **how** to process it.

The parser is the only component that understands sections. The state machine never knows where Section A starts or Section B ends. It only knows the current Question object.

## Phase 3 Interaction with Existing Features

### Jump

Jump requires no additional logic.

If the operator jumps directly to Question 35, and Question 35 was parsed as NUMERICAL, PREPARE_FORM immediately performs the Numerical workflow because the parser already classified Question 35 during markdown parsing.

Jump never scans for sections. Jump never counts questions. Jump simply changes the current Question pointer.

### Pass Step

Pass Step remains unchanged. It skips states exactly as before.

Whether the current question is MCQ or NUMERICAL does not change the philosophy of Pass Step. Pass Step never performs DOM interaction. Pass Step never performs automation.

## Phase 3 Live Validation

Upload complete real JEE papers containing alternating Section A and Section B.

Confirm automatic switching between MCQ and Numerical.

### NON-GOALS
Version 2 will NOT include

- Full automation
- Automatic image handling
- Automatic tag generation
- Automatic AI waiting
- Automatic save verification
- Automatic recovery decisions

These remain deliberate manual responsibilities.

### Expected result
At the completion of Version 2, the extension should:

- Recover easily from operator mistakes.
- Recover easily after browser reloads.
- Support both MCQ and Numerical questions automatically.
- Preserve the semi-automatic workflow.

## Future Polish

- Disable Execute Step when no markdown session is loaded.
- Disable Pass Step when no markdown session is loaded.
- Enable both automatically after parsing.