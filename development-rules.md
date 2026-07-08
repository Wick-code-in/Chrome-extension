# Development Rules

Version 1 is complete (see [CHANGELOG.md](CHANGELOG.md)). These rules were followed throughout its build and continue to apply to Version 2 development.

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

## Parser

Block-based, not line-based. Each numbered question is one block, extending from its number to the next numbered question or end of file.

Preserve each block's original markdown exactly, except for the structured fields extracted from it. Only identify question boundaries and extract fields — never normalize whitespace, reformat markdown, rewrite equations, modify LaTeX, change bullet points, or trim internal blank lines.

## Browser Helpers

Keep generic.

Never include business logic.

Use MutationObserver-based waiting with a bounded timeout. No fixed-interval polling.

Never use setTimeout(), setInterval(), sleep(), or await new Promise(...) to wait for the UI. Every wait must be driven by an observable condition (element exists, becomes visible, disappears, an attribute changes, a MutationObserver callback fires). Bounded timeouts exist only as a failure limit, never as the synchronization mechanism itself.

## State Machine

Advance only after success.

Validate preconditions before acting in every state.

Log every state transition.

## Persistence

Decided for Version 1: no persistence. Session state lives in memory only (`lib/session.js`) and does not survive a page reload — inspection of the target site during early implementation phases showed no full page reload occurs during the normal upload flow, so persistence was not required for Version 1's scope. Resume support and crash/session recovery are Version 2 roadmap items (see [CHANGELOG.md](CHANGELOG.md#roadmap--version-2)); do not build ahead of that phase being explicitly started.

## Communication

Explain decisions.

Ask before making assumptions.

Stop after every phase.