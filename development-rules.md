# Development Rules

## General

- Build incrementally.
- One phase at a time.
- Never implement future phases.
- Never scaffold future files.

## Scope

Version 1 is text-only. Never implement image upload, processing, or automation.

Detect Markdown image syntax (`![](...)`) and HTML `<img>` tags in the parser, and mark the Question Object with `hasImage: true`. Do not otherwise act on image content.

When `hasImage` is true, pause execution and inform the user that manual image insertion is required before continuing.

Never assume a fixed exam pattern (e.g., a fixed number of questions per subject or section). The parser only extracts questions — it must not know about, validate, or enforce subject, section, or exam-level structure. Subject, question type, and section size are user-configured through a future UI phase, not hardcoded.

## Coding

- Prefer simple code.
- Prefer readability.
- Prefer modularity.

## Browser Helpers

Keep generic.

Never include business logic.

Use MutationObserver-based waiting with a bounded timeout. No fixed-interval polling.

## State Machine

Advance only after success.

Validate preconditions before acting in every state.

Log every state transition.

## Persistence

Do not assume a persistence mechanism or target-site navigation behavior in advance.

Decide the persistence strategy based on inspection of the actual target website during early implementation phases.

## Communication

Explain decisions.

Ask before making assumptions.

Stop after every phase.