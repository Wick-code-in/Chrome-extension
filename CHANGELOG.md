# Changelog

All notable changes to the Exam Upload Assistant are documented in this file.

## [1.0.0] — Version 1 Complete — 2026-07-08

Version 1 is feature-complete and live-tested end to end, including across multiple consecutive questions: loading a Markdown file of MCQ questions and guiding a human operator, one Execute Step at a time, through creating each question on the target site.

### Added

- Manifest V3 extension skeleton: Shadow DOM-isolated panel, restricted to the target site only, no duplicate injection on reload.
- Draggable assistant panel: question counter, current state, status message, progress bar, Execute Step button, Load Markdown button.
- Local Markdown file loading (in-memory only, no upload).
- Block-based Markdown parser producing Question Objects (`questionNumber`, `questionMarkdown`, `type`, `options`, `correctAnswer`, `hasImage`, `imageMarkdown`), preserving each block's original markdown exactly — no whitespace normalization, reformatting, or reformatted LaTeX/equations.
- The full 9-state guided workflow: `IDLE → PREPARE_FORM → PASTE_QUESTION → PASTE_OPTIONS → MARK_CORRECT → GENERATE_AI → SAVE → NEXT_QUESTION`, looping back to `PREPARE_FORM` for each remaining question, terminating at `COMPLETE`.
- Generic, reusable browser automation primitives (`lib/domHelpers.js`): `findElement`, `isVisible`, `waitForElement`, `waitForDisappear`, `clickElement`, `fillInput`, `pasteMarkdown`, `selectDropdown` — all MutationObserver-driven, no polling or fixed delays anywhere.
- A centralized, live-verified selector library (`lib/selectors.js`) — the only file in the project permitted to hardcode a target-site selector.
- A single reusable "Markdown import modal" automation (`pasteMarkdown()`), shared by the Question field and every Option field, since it takes its selectors as a parameter rather than hardcoding a specific field.
- An image-question gate: a question with `hasImage: true` pauses the workflow before any browser interaction for that question, asking the operator to insert the image manually before continuing.
- A `{success, message, retryable}` contract on every state and helper, with every state transition logged and the workflow advancing only on success.

### Fixed

- **Option editor ancestor-scoping.** The Question field's label and its rich-text editor's toolbar button are direct siblings; each Option's are two DOM levels apart. The initial one-level lookup worked for Question but failed for Options. `findByLabelText()` was generalized into a bounded upward ancestor walk that finds the smallest containing ancestor instead of assuming a fixed depth — fixing Option automation without losing the scoping that keeps it from matching an unrelated field's identical structure.
- **Question Type selector collision after the first question is saved.** `PREPARE_FORM` correctly selected "MCQ Choice" for Question 1, but silently failed for every question after it — Marks, Penalty, and Question Text still filled correctly, but Question Type stayed on "Select type," and the step still reported success. Root cause: the selector matched a `<select>` via an unscoped, document-wide search for `option[value="single_choice"]`, unambiguous only until a question was saved — at which point an unrelated page-level filter control containing the same option value appeared elsewhere on the page and was silently matched instead. Diagnosed by temporarily instrumenting `selectDropdown()` to log the found element and its value at each step, confirming the function was succeeding against the wrong `<select>` entirely. Fixed by scoping the option search to the smallest ancestor of the already-verified "Marks" label, and by adding a post-write value verification to `selectDropdown()` so an equivalent collision would report an honest failure instead of a false success. Live-verified across six consecutive questions. See [architecture.md](architecture.md#major-bugs-encountered-and-solved) for the full root-cause writeup.

### Changed

- `GENERATE_AI` and `SAVE` were simplified from their originally planned scope (click, wait for completion/dialog-close, verify the result) to click-only, advancing immediately. This reflects Version 1's semi-automatic design: the operator reviews the AI-generated explanation and confirms the save manually, and each Execute Step press is an explicit human decision — not a shortcut taken to save implementation effort.
- `clickElement()` now checks whether an element is disabled before clicking it, rather than issuing a silent no-op click and reporting false success — several primary-action buttons on the site are conditionally disabled.

---

## Roadmap — Version 2

Agreed scope for the next version:

- **Resume support** — restore an in-progress upload session after a page reload.
- **Jump to Question** — let the operator manually select which question to work on next, rather than only sequential progression.
- **Skip Question** — explicitly skip the current question without saving it, and move on to the next.
- **Crash/session recovery** — recover session state (parsed questions, current index, current state) after the browser tab or extension is unexpectedly closed.
