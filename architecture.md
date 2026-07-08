# Architecture

This document describes how the Exam Upload Assistant is actually built: module responsibilities, the core mechanisms that make browser automation against a React-controlled site reliable, the major design decisions made during Version 1, and the major bugs encountered along the way and how they were solved.

For product scope and philosophy, see [context.md](context.md). For the phase-by-phase build record, see [Implementation.md](Implementation.md). For the release history and Version 2 roadmap, see [CHANGELOG.md](CHANGELOG.md).

---

## Module Map

Manifest V3, vanilla JavaScript, no build system, no framework. All content-script files run in a single isolated JS world per frame, in the order listed in `manifest.json`, each an IIFE that assigns its public API to `window.ExamUploadAssistantX`.

Load order (as declared in `manifest.json`) and why it matters:

```
lib/parser.js       — pure function: markdown text -> Question Object[]. No DOM access.
lib/session.js       — single source of truth for session state.
lib/domHelpers.js    — generic browser interaction primitives.
lib/selectors.js     — the only file that may hardcode a target-site selector.
lib/stateMachine.js  — orchestrates the workflow using Session + DomHelpers + Selectors.
content/loader.js    — local file picker + FileReader.
content/panel.js     — the panel UI: renders state, wires buttons to the state machine/loader.
content/content.js   — injects the Shadow DOM host and creates the panel.
```

`stateMachine.js` captures `Session`, `DomHelpers`, and `Selectors` once at module-load time (`const Session = window.ExamUploadAssistantSession;` etc.), so `domHelpers.js` and `selectors.js` must be loaded before it — this ordering is load-bearing, not incidental.

| File | Responsibility | Must NOT contain |
|---|---|---|
| `lib/parser.js` | Convert raw markdown into Question Objects, preserving each block's original markdown exactly. | Any DOM/browser access, any target-site knowledge. |
| `lib/session.js` | The single source of truth: raw markdown, parsed questions, current question index, current state. | Any DOM access, any parsing logic. |
| `lib/domHelpers.js` | Generic DOM primitives (`findElement`, `isVisible`, `waitForElement`, `waitForDisappear`, `clickElement`, `fillInput`, `pasteMarkdown`, `selectDropdown`) and the selector-descriptor resolver. | Any target-site selector string, any business/workflow logic. |
| `lib/selectors.js` | Every target-site selector, one place, verified against the live site. | Any DOM querying itself — only selector *definitions*. |
| `lib/stateMachine.js` | The 9-state workflow: what each state does, in what order, and when to advance. | Any `querySelector` of its own — all DOM access goes through `DomHelpers`. |
| `content/loader.js` | Local `.md` file selection and reading. | Parsing, session mutation beyond exposing the raw text. |
| `content/panel.js` | Render the panel, wire its two buttons to `StateMachine.executeStep()` and `Loader.openFilePicker()`. | Automation logic, parsing, selector knowledge. |
| `content/content.js` | Inject the Shadow DOM host once, create the panel. | Everything else. |

This separation is what makes the two documented bugs below tractable: because every DOM query goes through `domHelpers.js` via a descriptor defined in `selectors.js`, a wrong-element bug is always fixable in exactly one of two small, well-known places — never a hunt through the state machine or UI code.

---

## The `{success, message, retryable}` Contract

Every state handler and every `domHelpers.js` function that can fail returns this shape. The state machine advances to the next state **only** when `success === true`; on failure, the current state is retried by pressing Execute Step again (or the operator resolves whatever `message` describes — e.g. inserting an image manually — and then retries). Every transition is logged via `console.log("[Exam Upload Assistant]", state, "->", result)`, unconditionally, for debugging.

`retryable` is informational (distinguishing "try again, this might be transient" from "this question's data is the problem") — the current UI does not yet act on it differently; that's part of the Version 2 error-handling roadmap.

---

## The Selector Descriptor System

`selectors.js` is the only file permitted to hardcode a target-site selector; everything else refers to selectors by name. A selector value resolved by `domHelpers.js`'s `findElement()` is one of:

- **A plain CSS string** — passed straight to `querySelector`.
- **`{ tag, text, closest }`** — matches an element by tag + exact visible text (for Tailwind-only buttons with no other stable attribute), optionally walking up to the nearest ancestor matching `closest` via `Element.closest()` (used when the stable text belongs to a descendant, e.g. a dialog's title, rather than the dialog itself).
- **`{ labelText, find }`** — finds the `<label>` with that exact text, then returns the first match of `find` (default `"input, select, textarea"`) within the *smallest* ancestor of the label that contains one. This walks upward one level at a time rather than assuming a fixed depth, because the label and its target aren't always direct siblings (see the Option ancestor-scoping bug below).
- **`{ optionValueParent, nearLabel }`** — finds an `<option>` by its exact `value` attribute and returns its parent `<select>` (for a `<select>` with no stable attribute of its own). Unscoped unless `nearLabel` is given, in which case the option search is scoped via the same ancestor-walk as `{ labelText, find }` — anchored to a known-nearby label (see the Question Type collision bug below).

Every entry in `selectors.js` carries a comment recording *when* it was verified and *why* that particular shape was chosen over the alternatives — this was a deliberate practice throughout Version 1 (selectors were never written from assumption; every one was confirmed against real HTML pasted from the live site before being committed).

---

## Why Native Property Setters Are Used Instead of `element.value = x`

The target site's form controls are React-controlled. Assigning `element.value = x` directly does not reliably notify React of the change, because React overrides the instance's own `value` setter to track state internally. `fillInput()` and `selectDropdown()` instead retrieve the *native* setter directly from the element's prototype —

```js
Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
```

— and invoke it via `.call(element, value)`, bypassing whatever React has layered on the instance. This is followed by dispatching real `input` and `change` events (`new Event(type, { bubbles: true })`), which React's own event delegation picks up correctly, updating its internal state as if a real user interaction occurred.

`selectDropdown()` additionally re-reads `element.value` after this sequence and compares it against the intended value, returning a genuine failure if it doesn't match, rather than assuming the write succeeded just because nothing threw. This check was added directly in response to the Question Type collision bug below, where the previous version reported success purely because no exception occurred.

---

## Waiting Strategy: MutationObserver Only

`waitForElement()` and `waitForDisappear()` never poll on a fixed interval and never use a bare `setTimeout`/`sleep` as the synchronization mechanism. Both resolve via a `MutationObserver` watching for the relevant condition (element appears + becomes visible, or element disappears/becomes invisible), with a bounded `setTimeout` running *alongside* the observer purely as a failure limit — if the observer never fires, the wait resolves as a `{success: false, retryable: true}` timeout rather than hanging indefinitely.

Both observers watch `document.documentElement` rather than the `root` element they were scoped to search within. This is deliberate: if the site's framework replaces `root` wholesale (unmount/remount) rather than mutating it in place, an observer attached to the old `root` reference would never see the replacement — `documentElement` is never swapped out for the life of the page, so it remains a reliable observation target regardless of what happens inside it. The *query* itself still respects `root`; only the mutation-detection target is document-wide.

---

## `pasteMarkdown()`: One Reusable Workflow, Not a Per-Field Copy

Every rich-text field on the target site (Question, each Option, and — architecturally — any future rich-text field such as Explanation) is a TinyMCE editor. Direct manipulation of the TinyMCE editor DOM proved unreliable; the site instead provides an official "Paste Markdown Data" import modal per field, triggered by a "Paste Raw Markdown" toolbar button, with a shared textarea and confirm button.

`domHelpers.js`'s `pasteMarkdown()` encapsulates the entire five-step sequence once — click the field's trigger button, wait for the shared modal to appear, fill its textarea (scoped to the modal, via the *exact*, unmodified markdown text), click confirm (scoped to the modal), wait for the modal to disappear — and takes the four relevant selectors as a parameter bundle (`triggerButton`, `modal`, `textarea`, `confirmButton`) rather than hardcoding any of them. `runPasteQuestion()` calls it once; `runPasteOptions()` calls it once per option letter in a loop. No state handler duplicates this sequence.

---

## Major Architectural Decisions

1. **Session as the single source of truth.** `lib/session.js` owns raw markdown, parsed questions, current index, and current state. The loader only loads files; the parser only parses; the panel only displays; the state machine only orchestrates — each reads and writes through `Session`'s public API, never past each other.
2. **`selectors.js` is the only file allowed to hardcode a target-site selector.** Enforced by convention and checked by grep at the end of every phase — no `querySelector` call exists outside `domHelpers.js` (aside from the panel's own Shadow DOM UI, which is not target-site content).
3. **`domHelpers.js` stays generic; business logic lives only in `stateMachine.js`.** Helpers never know what a "Question" or "Marks field" is — they operate purely on selectors and values passed in.
4. **MutationObserver-only waiting**, with bounded timeouts used exclusively as failure limits — never `setTimeout`/`sleep` as the actual synchronization mechanism. See above.
5. **`option[value="..."] + .parentElement` over the `:has()` relational selector**, for the Question Type dropdown. Both work in a content script (the same CSS engine as page scripts, no MV3-specific restriction on `:has()`), but `:has()` is a comparatively recent CSS feature (Chrome 105+); the attribute-selector approach has no browser-version floor at all and reaches the identical element.
6. **The Markdown import modal, not direct TinyMCE manipulation**, is the mechanism for populating every rich-text field — discovered via live inspection after direct manipulation proved unreliable, then generalized into the single reusable `pasteMarkdown()` helper described above.
7. **`GENERATE_AI` and `SAVE` are click-only, advancing immediately** — a deliberate simplification from the original plan (which specified waiting for completion/dialog-close and verifying the result). The extension is semi-automatic by design: after `GENERATE_AI` clicks the button, the operator reviews and edits the AI-generated explanation manually; after `SAVE` clicks the button, the operator manually confirms the save succeeded. Each subsequent Execute Step press is an explicit human decision to proceed, not an automated continuation. See [context.md](context.md) for the philosophy this reflects.
8. **`clickElement()` checks for a disabled element before clicking.** Several primary-action buttons on the site (Generate with AI, Save Question) are conditionally disabled via Tailwind `disabled:*` classes; clicking a disabled element is a silent no-op in the DOM, which would otherwise be misreported as success.

---

## Major Bugs Encountered and Solved

### 1. Option editor ancestor-scoping (Phase 9)

**Symptom:** the design used for the Question field's "Paste Raw Markdown" button — anchor to the field's `<label>`, assume the button is a direct sibling — was planned to be reused unchanged for each Option field.

**Root cause:** live HTML inspection showed each Option's label and its editor's toolbar button are **two DOM levels apart**, not siblings — the label sits in a header row, while the editor (and its toolbar) is a separate sibling subtree. The original `findByLabelText()` only checked one fixed level up from the label.

**Fix:** `findByLabelText()` was generalized from a fixed one-level lookup into a bounded upward ancestor walk — starting at the label's parent, checking `ancestor.querySelector(searchSelector)` at each level, and returning the first match, stopping at the shallowest ancestor that contains one (bounded by the given `root`, so it can never walk past the caller's intended scope). This fixed Option automation without weakening the scoping that keeps it from matching the wrong field — the walk still stops at the *smallest* container that works, so it can't accidentally cross into a sibling field's identical toolbar structure.

This generalized ancestor-walk is now the shared mechanism behind `{ labelText, find }` and (via `nearLabel`) `{ optionValueParent, nearLabel }` alike.

### 2. Question Type selector collision after the first question is saved (post-Phase 12)

**Symptom:** `PREPARE_FORM` correctly selected "MCQ Choice" for Question 1. For every question after it, Marks/Penalty/Question Text still filled correctly, but Question Type silently remained "Select type" — and `PREPARE_FORM` still reported success. Waiting longer made no difference (ruled out as a timing issue).

**Root cause:** the Question Type selector was `{ optionValueParent: "single_choice" }` — unscoped, matching the first `option[value="single_choice"]` anywhere in `document`. This was unambiguous only while the "Add Question" dialog was the sole element on the page containing that option value. Once a question was saved, an unrelated page-level filter control appeared elsewhere on the page — also containing `option[value="single_choice"]`, alongside `"All Types"` and `"Question Group"` options that don't exist in the dialog — and, sitting earlier in DOM order, was silently matched instead. The native setter and event-dispatch sequence genuinely succeeded against this wrong element, so nothing ever signaled failure.

**Diagnosis:** rather than guess, `selectDropdown()` was temporarily instrumented to log the found element, its value before/after the native setter, its value after event dispatch, and the final success/failure — confirming the function was working exactly as designed, just against the wrong `<select>`.

**Fix:** `findByOptionValueParent()` gained an optional `nearLabel` parameter that, when given, scopes the option search through the same ancestor-walk mechanism as `{ labelText, find }` — anchored to the already-verified "Marks" label (known, since Phase 7, to exist only inside the dialog). `questionTypeDropdown` became `{ optionValueParent: "single_choice", nearLabel: "Marks" }`. `selectDropdown()` also gained the post-write value verification described above, so an equivalent future collision would report an honest failure instead of a false success. The diagnostic logging was removed once the fix was live-verified across six consecutive questions.

---

## Debugging Notes

**DevTools console context.** `window.ExamUploadAssistantX` objects are defined in the content script's isolated JS world, not the page's main world. If the DevTools console's context selector is left on "top," these globals will appear undefined even though the extension is running correctly — switch the console's context dropdown to the extension's isolated world before inspecting state from the console.
