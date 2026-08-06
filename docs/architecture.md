# Docxsity Architecture

This document explains the design philosophy behind `sites/docxsity/*` and the boundary between it and the rest of the extension. For the state-by-state behavior this philosophy produces, see [docxsity.md](docxsity.md). For specific decisions and their rationale, see [decisions.md](decisions.md). For investigations that shaped this design, see [debugging-notes.md](debugging-notes.md).

Note: the repository also has a root-level `architecture.md`, which documents Version 1 of the extension (the original single-site `lib/*` implementation, before the Modality/Docxsity split). This document is scoped only to the current two-site architecture.

---

## Shared vs. site-specific code

```
lib/parser.js, lib/session.js        — shared, website-independent
content/loader.js, panel.js,
  panel.css, content.js               — shared, website-independent

sites/modality/
  selectors.js, domHelpers.js, stateMachine.js   — Modality-only

sites/docxsity/
  config/markingSchemes.js
  selectors.js, domHelpers.js, stateMachine.js   — Docxsity-only
```

`manifest.json` has one `content_scripts` entry per domain, each loading the shared files plus only that site's own three files. Site selection happens once, at Chrome's own URL-matching layer, before any of the extension's JS runs — there is no `if (isDocxsity)` branch anywhere in the code. Both sites' files reuse the same global names (`window.ExamUploadAssistantSelectors`, `...DomHelpers`, `...StateMachine`) safely, because manifest-level `matches` guarantees only one site's files are ever injected into a given page.

**Why this split exists:** the first Docxsity integration attempt shared runtime automation code with Modality. As Docxsity-specific changes accumulated, that shared code grew branchy and eventually regressed the stable Modality implementation — the whole attempt was reverted (preserved on the `docxsity-experiment` branch as reference only). The rule going forward: only code that is *genuinely* website-independent — the question model, session state, and shared UI — is shared. Each site owns its selectors, DOM helpers, waits, and workflow completely, even where the two implementations end up looking similar. Similar-looking code between the two sites is expected and acceptable; it is deliberately never generalized into shared automation code, because that generalization is exactly what caused the original regression.

The one exception, and the only one that has come up in practice: `content/panel.js`'s busy guard (below) — genuinely site-independent, so it lives in shared code by the same rule, not as an exception to it.

---

## The state machine's interface contract

Every site's `stateMachine.js` exposes the same shape, which is all `content/panel.js` depends on:

```js
window.ExamUploadAssistantStateMachine = {
  STATES: { IDLE, PREPARE_FORM, PASTE_QUESTION, PASTE_OPTIONS, MARK_CORRECT,
            GENERATE_AI, ADD_TAGS, SAVE, NEXT_QUESTION, COMPLETE },
  executeStep, passStep, jumpToQuestion,
};
```

`panel.js` never touches selectors or DOM helpers directly, and never knows which site it's driving — it only calls this interface plus `window.ExamUploadAssistantSession`/`...Loader`/`...Parser`. This is what lets the same shared panel UI drive either site without any site-detection logic of its own.

---

## Why states verify completion instead of assuming success

Every `{success, message, retryable}` result a state handler returns reflects an **observed** DOM condition, not the absence of a thrown error. This runs deeper than "click and hope":

- `clickElement()` refuses to click an element that's missing, invisible, or disabled, rather than calling `.click()` on it and reporting success regardless.
- `waitForElement()`/`waitForDisappear()` resolve only once a `MutationObserver` confirms the condition is actually true in the DOM, with a bounded timeout as a failure limit — never a fixed delay standing in for "probably done by now."
- Several states go further and verify their own *effect*, not just that a helper call didn't fail: `GENERATE_AI` reads the Explanation editor's actual text content after the button re-enables (a re-enabled button doesn't by itself prove content was generated); `ADD_TAGS` waits for the tag's own pill to render with the exact subject text, not just for the click to register; `SAVE` waits for the modal to actually disappear and, if it doesn't, reads the page's own validation-error elements rather than reporting a generic timeout.

The reason: browser automation against a live, framework-driven site has many ways to *appear* to succeed while doing nothing (a disabled button silently no-ops on `.click()`, a React/Angular-controlled input can ignore a raw `.value` assignment, a click can land on the right element before that element's own async work has actually finished). A state that only checks "did my helper call throw" cannot distinguish that from real success. Every state instead checks for a condition that could only be true if the intended effect actually happened — which is also what makes every state **independently retryable**: pressing Execute Step again after a failure re-runs the same checks from the current, real DOM state, rather than compounding an assumption that was already wrong once.

---

## Selector philosophy

`sites/docxsity/selectors.js` is the only file permitted to hardcode a Docxsity selector — the same convention `sites/modality/selectors.js` follows for Modality, enforced independently per site. Every entry is verified against the live site (not inferred from the reverted experiment branch's static DOM export) and carries a comment recording what was checked and why that particular shape was chosen. Three descriptor shapes are supported, in preference order roughly matching how stable they are against markup/framework changes:

1. **A plain CSS string** — used only when there's a genuinely stable class or attribute to hang onto (e.g. `button.qm-btn-generate-ai`, `.qm-error`).
2. **`{ tag, text, closest }`** — matches an element by exact trimmed visible text, optionally walking up to a container via `closest()`. Preferred over positional selectors (`:nth-of-type`) wherever visible text is available, because it doesn't depend on sibling order or count staying fixed — chosen explicitly for the option-card selector even though a positional selector would resolve to the same element today.
3. **`{ labelText, find }`** — anchors to a `<label>`'s exact text, then searches outward from it for the target control. Used for every native form field that has a real `<label>`.

Structural selectors are preferred over accessibility-attribute selectors (`aria-label`, `aria-labelledby`) specifically because those attributes were confirmed, via the Windows investigation (see [debugging-notes.md](debugging-notes.md)), to vary across environments in ways visible text does not.

---

## DOM helper philosophy

`sites/docxsity/domHelpers.js` stays generic: it operates purely on selector descriptors and values passed in, and never knows what a "Question" or "Marks field" is — that knowledge lives only in `stateMachine.js`. New primitives are added only when composing existing ones genuinely can't express the behavior needed (this happened once, for ng-select interaction — `mousedown` on `.ng-select-container` rather than a plain `.click()`, since ng-select binds its open handler to that child element specifically). `ensureOptionCount()` and `pasteMarkdown()` are deliberately *not* new primitives — both are compositions of `findElement`/`clickElement`/`waitForElement`/`fillInput` that live in `stateMachine.js` and `domHelpers.js` respectively, because the existing primitives were already sufficient.

`pasteMarkdown()` is the one piece of interaction logic reused across three different call sites (Question Text, each Option, and — for Modality only — Instruction text): click a trigger button, wait for the shared "Paste Markdown Data" import dialog, fill its textarea, click confirm, wait for the dialog to disappear. It deliberately switches from the caller's scoped `root` to document-wide scope partway through, because the dialog itself is TinyMCE-native and appended directly to `document.body` — confirmed live to not be a descendant of the Add Question modal.

---

## The modal-root-once pattern

Each state that needs to interact with the Add Question modal re-resolves it fresh, at the top of that state, via `waitForElement(Selectors.addQuestionModal)` — state handlers never carry a DOM reference from one state to the next through any shared variable. Since the modal is already open by the time a later state runs, this wait settles near-instantly; its purpose isn't to wait meaningfully, it's to guarantee every state scopes its own field lookups to a root it has itself just confirmed exists, rather than trusting that an earlier state's root reference is still valid. This mirrors Modality's `resolveCurrentRoot()`, which does the same thing for the same reason (and additionally resolves a Sub Question card for Question Group members, which Docxsity has no equivalent of).

---

## Panel-wide busy guard

`content/panel.js` disables Execute Step, Pass Step, and the Jump input/button together, synchronously, before an in-flight `executeStep()` call's first `await` — closing the window where a second click (on any of the three controls) could run concurrently with it. This exists because `executeStep()` is async and can be mid-flight for anywhere from milliseconds to tens of seconds (a `GENERATE_AI` step, in particular); `Session`'s current state isn't written until the in-flight handler resolves, so nothing previously stopped a second Execute Step from re-dispatching to the same handler, or Pass Step/Jump from mutating `Session` while that handler was still acting on the page.

This lives in shared code, not per-site, because the re-entrancy gap it closes exists identically in both `stateMachine.js` implementations — it is a property of `content/panel.js`'s own event wiring, not of either site's DOM. See [decisions.md](decisions.md) for the reasoning that led to placing it here rather than adding a guard inside each state machine.
