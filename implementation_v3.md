# Exam Upload Assistant - Version 3 Implementation Plan

## Version 3 Philosophy

Version 2 completed the functional vision of the extension.

The extension now successfully supports:

- MCQ workflow
- Numerical workflow
- Pass Step
- Jump to Question
- Section-aware parsing
- Dynamic workflow selection

Version 3 is **not** about adding new automation.

Version 3 is a **polish and robustness release**.

Its purpose is to make the extension feel more reliable, predictable and pleasant to use during long upload sessions while preserving the architecture established in Version 2.

---

## Official Markdown Specification

The Exam Upload Assistant consumes one official markdown specification.

This specification is produced exclusively by the project's PDF → Markdown generator.

The parser is intentionally strict.

Supporting multiple markdown formats is intentionally out of scope.

If the specification changes in the future, the generator should be updated to emit the new specification rather than increasing parser complexity.

---

# Core Design Philosophy

The extension is an assistant, not an operator.

The operator always remains in control.

The extension should:

- Reduce repetitive work.
- Remove unnecessary manual clicks.
- Make its actions visible.
- Be deterministic.
- Be predictable.
- Never guess operator intent.

The extension should never:

- Decide when the website has finished processing.
- Automatically continue to the next step.
- Retry actions automatically.
- Hide what it is doing.
- Infer missing information.
- Add "smart" behaviour that removes operator control.

The operator is responsible for:

- Verifying every completed step.
- Deciding when website processing has finished.
- Pressing Execute Step.
- Choosing when to use Pass Step.
- Choosing when to Jump.
- Correcting website-side issues.

This philosophy has guided Version 2 and must remain unchanged.

---

# Version 3 Goals

Version 3 focuses on four improvements only.

No additional features should be added unless they solve a real workflow problem discovered during production use.

We now own both the markdown generator and the extension parser, and the generator has been standardized to emit exactly the format the parser expects. The parser therefore stays strict: it continues to expect one official markdown specification, with no validation layer and no tolerance for alternative formatting. If the generator ever regresses, parsing failures should surface naturally rather than being caught by a separate validation step.

---

# Phase 1 - Post-action Auto Focus

## Goal

Improve operator visibility after every automated action.

This feature exists entirely for the operator.

It is NOT intended to help the extension.

Workflow:

Execute Step

↓

Extension performs its action

↓

Extension scrolls so the relevant area is visible

↓

Extension stops

↓

Operator verifies the result

↓

Operator decides when to continue

Examples

Generate AI

After clicking Generate AI, scroll so the Generate AI section remains visible.

Save

After clicking Save, scroll so the Save button and surrounding validation messages are visible.

The extension must never:

- Wait for completion.
- Detect processing.
- Continue automatically.
- Poll the page.

The operator remains responsible for deciding when processing has finished.

---

# Phase 2 - On-demand Panel

## Goal

Prevent the panel from automatically appearing whenever the website opens.

Desired workflow

Open website

↓

No extension panel

↓

Click extension icon

↓

Panel appears

↓

Close panel

↓

Website returns to its normal appearance

The extension should feel invisible until intentionally opened.

---

# Phase 3 - Truthful UI

## Goal

Only allow actions that are currently valid.

Example

No markdown loaded

Execute Step
Pass Step
Jump

should all be disabled.

Once a markdown file is loaded

Execute Step
Pass Step
Jump

become enabled.

This is not recovery logic.

This is not automation.

It is simply truthful UI.

---

# Phase 4 - Better Status Messages

## Goal

Improve operator feedback.

Instead of generic messages

PREPARE_FORM completed.

provide meaningful summaries.

Examples

MCQ

✓ Selected MCQ Choice

✓ Marks set to 4

✓ Penalty set to 1

Numerical

✓ Selected Fill Blank

✓ Marks set to 4

✓ Penalty skipped

Jump

✓ Jumped to Question 38

Pass

✓ Skipped PASTE_OPTIONS

Completion

Instead of

All questions complete.

display

Upload Complete

75 Questions Uploaded

60 MCQ

15 Numerical

Completed Successfully

These are purely informational.

They never change workflow behaviour.

---

# Features intentionally rejected

The following ideas were discussed and deliberately rejected because they conflict with the extension philosophy.

## Automatic retries

Rejected.

The operator decides how to recover.

---

## Automatic waiting

Rejected.

The operator decides when website processing has finished.

---

## Automatic next-step execution

Rejected.

One Execute Step performs exactly one workflow step.

Nothing more.

---

## Automatic error recovery

Rejected.

Recovery belongs to the operator.

---

## Highlight clicked elements

Rejected.

Adds visual noise without improving productivity.

---

## Step execution timing

Rejected.

The operator—not the extension—decides when a step has completed.

Timing information provides little value.

---

## Additional Jump shortcuts

Rejected.

Current Jump workflow is already efficient.

No meaningful productivity gain.

---

# Version 3 Success Criteria

Version 3 is complete when:

- Post-action auto focus improves operator visibility.
- Panel only appears when intentionally opened.
- Invalid actions are disabled until a markdown file is loaded.
- Status messages clearly describe completed work.
- No Version 2 workflow is altered.
- No operator control is removed.
- No new automatic behaviour is introduced.

---

# Long-term Philosophy

Future versions should continue following one simple rule:

Every new feature must solve a real workflow problem discovered during production use.

Avoid speculative features.

Avoid complexity for its own sake.

Predictability is more valuable than cleverness.

The extension succeeds because it assists the operator—not because it attempts to replace them.