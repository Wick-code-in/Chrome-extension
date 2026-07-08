# Development Rules

## General

- Build incrementally.
- One phase at a time.
- Never implement future phases.
- Never scaffold future files.

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