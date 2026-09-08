# Slideshow Automation

This document covers the Slideshow automation feature end to end: why it was built, exactly how `lib/slideshow.js` and the states it drives work, what races were found and fixed, what was deliberately left out, and what was and wasn't verified. It is the source of truth for this feature — prefer this over any session memory when the two disagree.

Related documents: [architecture.md](architecture.md) covers the shared-vs-site-specific split Slideshow follows and the panel-wide busy guard it extends. [decisions.md](decisions.md) covers the specific architectural calls made while building this feature (single capability flag, no DOM in the controller, condition-based waits over delays). [debugging-notes.md](debugging-notes.md) has the two live-DOM-timing investigations this feature's readiness fixes are based on. [docxsity.md](docxsity.md) documents the state-by-state Docxsity behavior Slideshow drives unchanged.

**Status**: implemented and live-verified against real Docxsity (disposable banks, deleted after each test — see §15). Docxsity-only by design; Modality explicitly does not support it (§7). Most of this feature (the controller, panel restructuring, the TinyMCE readiness fix, the post-Save readiness fix) is committed in `c9635cd` ("Automation added"). The Generate-AI auto-scroll addition (§14) is present in the working tree as of this writing and had not yet been committed by the project owner at the time this document was written — confirmed via `git status`/`git diff --cached`, not assumed.

---

## 1. Why Slideshow was introduced

Before this feature, the extension only had a manual workflow: an operator clicks Execute Step once per state, watches the result, and clicks again — or uses Pass Step to skip a state, or Jump to reposition. That workflow is driven entirely by `StateMachine.executeStep()` / `passStep()` / `jumpToQuestion()`, `Session`, and each site's own `domHelpers.js`/`selectors.js` — none of that changed.

**Slideshow's entire purpose is to call the existing `executeStep()` repeatedly, automatically, instead of requiring a human to click Execute Step once per state.** It is an orchestration layer sitting *above* the existing state machine, not a second implementation of the exam workflow. It contains:

- no new state definitions,
- no duplicated PREPARE_FORM/PASTE_QUESTION/PASTE_OPTIONS/MARK_CORRECT/GENERATE_AI/ADD_TAGS/SAVE/NEXT_QUESTION logic,
- no new DOM interaction of its own.

Every question, every state transition, every Question-Group rule, every Settings toggle Slideshow ever touches is handled by code that already existed and is exercised identically whether a human or Slideshow triggered it. This is the single most important property of the design and the reason the rest of this document keeps returning to it.

---

## 2. `lib/slideshow.js` — architecture

The whole file is 128 lines. It exposes three functions on `window.ExamUploadAssistantSlideshow`:

```js
window.ExamUploadAssistantSlideshow = { isRunning, start, pause };
```

**`isRunning()`** — returns the module-scope `running` boolean. No other state is exposed.

**`start(callbacks)`** — an `async` function. On entry:
1. If `running` is already `true`, returns `{ started: false, reason: "already-running" }` immediately — a defense-in-depth guard against a caller invoking `start()` twice concurrently (the panel already prevents this via its own click-guard, but the controller doesn't trust that alone).
2. Reads `window.ExamUploadAssistantStateMachine.supportsSlideshow`. If falsy, calls `callbacks.onStopped("unsupported", null)` and returns without ever setting `running = true` — this is the capability check described in §7, and it runs regardless of whether the caller is the real panel or a direct console call.
3. Sets `running = true` and `stopRequested = false` synchronously, before any `await` — so `isRunning()` reflects the new run's state the instant `start()` is called, even though the function keeps executing asynchronously after that point.
4. Enters a `while (true)` loop, wrapped in `try { ... } finally { running = false; callbacks.onStopped(reason, lastResult); }`.

**The loop body**, each iteration:
```js
if (Session.getCurrentState() === "COMPLETE") { reason = "complete"; break; }
if (stopRequested) { reason = "paused"; break; }
lastResult = await StateMachine.executeStep();
if (typeof callbacks.onStep === "function") { callbacks.onStep(lastResult); }
if (!lastResult.success) { reason = "failed"; break; }
```

That's the entire orchestration. **The only state-machine call anywhere in this file is `StateMachine.executeStep()`.** `passStep()` and `jumpToQuestion()` are never called by Slideshow.

- **Completion (`COMPLETE`)**: checked via `Session.getCurrentState() === "COMPLETE"` — a direct `Session` state check, never a check on `result.message` text. This is checked both before starting a step (so a run that begins already at `COMPLETE`, or that reaches it on the very last step, terminates cleanly either way) and is naturally arrived at because `executeStep()` itself transitions `Session` into `COMPLETE` once `NEXT_QUESTION` finds no more questions.
- **Failure handling**: `if (!lastResult.success) { reason = "failed"; break; }` — no branching on *why* it failed, no reading of `result.retryable` (that field is set throughout both state machines but has never been read by any caller — see [debugging-notes.md](debugging-notes.md)'s "Execute Step re-entrancy" entry), no retry loop, no counter. One failure of any kind stops the whole run.
- **`try/finally` protection**: the `while` loop lives inside a `try` block whose `finally` clause always sets `running = false` and always calls `callbacks.onStopped(reason, lastResult)`, even if `executeStep()` itself threw an unexpected synchronous or asynchronous exception (rather than resolving with `{success:false}`). This guarantees the panel is never left permanently locked because of an exception path nobody anticipated — the same "never leave the UI stuck busy" philosophy `content/panel.js`'s own `finally` safety net already applies to a single manual Execute click.
- **`onStep`/`onStopped` are plain optional callbacks**, invoked synchronously at the points shown above. `lib/slideshow.js` does not know or care what they do — `content/panel.js` is the only current caller, and it uses `onStep` to call the exact same `refreshFromSession()` a manual Execute click already calls, and `onStopped` to re-run the same control-availability logic (§6).

**`pause()`** — a one-line synchronous function: `stopRequested = true`. It does not touch `running`, does not call anything on `StateMachine`, and does not interrupt whatever `executeStep()` call is currently in flight (there is nothing in this file, or in the wait primitives it calls into, capable of doing that — see §4).

### Why the controller contains no DOM or selector logic

`lib/slideshow.js` never imports, references, or knows about `DomHelpers`, `Selectors`, or any site-specific module. It only ever touches `window.ExamUploadAssistantStateMachine` (for `executeStep` and the `supportsSlideshow` flag) and `window.ExamUploadAssistantSession` (for the `COMPLETE` check). This mirrors the project's own long-standing site-isolation rule (see [architecture.md](architecture.md)'s "Shared vs. site-specific code"): the *only* code allowed to touch a site's DOM is that site's own `domHelpers.js`/`selectors.js`/`stateMachine.js`. A Slideshow-specific DOM shortcut would have re-created exactly the kind of shared-automation coupling that caused the original Docxsity/Modality regression this project already reverted once (documented in architecture.md). Site-specific behavior — Question Group rules, marking-scheme resolution, Settings toggles, TinyMCE readiness, post-Save readiness, Generate-AI auto-scroll — all stay exactly where they already lived, inside each site's own `stateMachine.js`/`domHelpers.js`.

### What was deliberately NOT implemented

- **No second state machine.** `executeStep()` is the only thing that ever changes `Session`'s state or index.
- **No retry counter, no automatic retry system, no exponential backoff.** A failed step stops the run; retrying (via Execute Step) or skipping (via Pass Step) is left entirely to the operator.
- **No automatic Pass Step.** Slideshow never calls `passStep()` under any circumstance, including on failure — the brief explicitly ruled this out, since a structural failure (e.g. no marking scheme configured) would be silently skipped past rather than surfaced.
- **No rollback.** `Session` is left exactly where the failing (or paused) `executeStep()` call left it — no attempt is made to undo a partially-completed state.
- **No message-text-based completion detection.** Termination is a direct `Session.getCurrentState() === "COMPLETE"` check, never a string match against `result.message`.
- **No Slideshow-specific DOM manipulation.** Every DOM operation Slideshow ever triggers is one that `executeStep()` would have performed identically for a manual click.

### Why the controller was kept this small

Every one of the omissions above was a deliberate scope decision made explicitly during design review (see [decisions.md](decisions.md)), not an oversight. The guiding principle stated repeatedly during this feature's design phase was: *the smallest architecture-consistent addition that turns the existing reliable single-step execution primitive into sequential automatic execution* — anything beyond "call `executeStep()` in a loop, stop on failure/pause/complete" was treated as scope creep until concrete evidence showed otherwise (which is exactly the reasoning that later produced the two readiness fixes in §11–§12, once live reconnaissance — not speculation — showed they were needed).

---

## 3. Play behavior

Play is rendered only on Docxsity (`supportsSlideshow: true` — see §7). Its `<button data-field="play-button">` click handler in `content/panel.js`:

```js
playButtonEl.addEventListener("click", () => {
  if (isPanelBusy || window.ExamUploadAssistantSlideshow.isRunning()) return;
  window.ExamUploadAssistantSlideshow.start({ onStep, onStopped });
  applyMainControlsAvailability(currentHasQuestions());
});
```

**Play is enabled only when all of the following hold** (computed in `applyMainControlsAvailability`, §6):
- `hasQuestions` — a paper is loaded (`Session.getTotalQuestions() > 0`),
- `!isPanelBusy` — no single manual Execute Step call is currently in flight,
- `!Slideshow.isRunning()` — no run is already active,
- `Session.getCurrentState() !== "COMPLETE"` — pressing Play once the paper is finished would just loop harmlessly on `runComplete()`, so it's disabled instead, unlike Execute Step which stays enabled at `COMPLETE` (existing, unchanged behavior).

**On click**: `Slideshow.start()` is called (not awaited by the click handler itself — see the note in §6 on why this is safe), which synchronously sets `running = true` before its first `await`; the very next line in the click handler, `applyMainControlsAvailability(...)`, therefore already sees `isRunning() === true` and locks Execute/Pass/Jump/Load Markdown/Play immediately, before the first automated step has even started. The loop then runs, calling `onStep` (→ `refreshFromSession`) after every `executeStep()` call until it stops for one of the three reasons in §2.

---

## 4. Pause behavior, and why cancellation was not implemented

Pause is enabled only while `Slideshow.isRunning()` is `true`. Its handler:

```js
pauseButtonEl.addEventListener("click", () => {
  if (!window.ExamUploadAssistantSlideshow.isRunning()) return;
  window.ExamUploadAssistantSlideshow.pause();
  pauseButtonEl.disabled = true;
  api.setStatus("Pausing — finishing current step…");
});
```

- Clicking Pause sets `stopRequested = true` inside the controller — a plain flag write, nothing more.
- **Pause disables itself immediately** on click (the one direct `.disabled = true` write above), independent of the general `applyMainControlsAvailability` recomputation, so the operator gets instant visual feedback that the click registered even though the run hasn't actually stopped yet.
- **The currently executing `executeStep()` call is NOT cancelled.** There is no cancellation primitive anywhere in `waitForElement()`/`waitForDisappear()` in either site's `domHelpers.js` — both are `Promise`s that only ever `resolve()` (on success or on their own internal timeout), never `reject()`, and expose no `AbortController` or cancel handle to the caller. `pause()` cannot reach into an in-flight wait and stop it.
- **The loop's `stopRequested` check runs only between iterations** — after the current `executeStep()` call has fully resolved and `onStep` has already fired for it, and before the next one begins. This is why the current operation (including a slow `GENERATE_AI` or `SAVE`) is allowed to finish naturally.
- Once the loop actually exits (`reason: "paused"`), the `finally` block sets `running = false` and calls `onStopped`, which re-runs `applyMainControlsAvailability` — this is the point at which Execute/Pass/Jump/Load Markdown/Play actually re-enable and Pause actually re-disables.
- **The transient "Pausing — finishing current step…" text is overwritten automatically**, not by any special-cased code in the Pause handler: the in-flight step's own `onStep` callback (which fires the moment that step's `executeStep()` resolves) calls `refreshFromSession(result)`, which sets the Status text to that step's own real message — this naturally replaces the "Pausing…" placeholder with no extra logic needed.

**Why cancellation was not implemented**: doing so would require either (a) inventing a cancellation mechanism inside `waitForElement`/`waitForDisappear` that doesn't exist today, which risks destabilizing every other caller of those two functions across both sites, or (b) forcibly abandoning an in-flight DOM operation (e.g. a `GENERATE_AI` click mid-generation, or a `SAVE` click mid-network-request) with no way to know what state the live page was left in — a real risk of state corruption (a half-clicked Save, a Generate-AI call whose response arrives after Slideshow has already "moved on"). Given the measured real durations involved (Generate AI ~1.5–4.5s, Save ~2.5–2.9s — see [docxsity.md](docxsity.md)), letting the current operation finish naturally was judged the smaller, safer cost, worth the brief (bounded) delay before Pause actually takes effect.

---

## 5. Failure policy

When `executeStep()` returns `{success: false, ...}`, the following happens — uniformly, regardless of *why* it failed:

1. The loop breaks with `reason: "failed"`.
2. No retry is attempted.
3. No automatic Pass Step is called.
4. No rollback is attempted.
5. `Session` is left exactly where that `executeStep()` call left it (state, question index, everything) — `executeStep()` itself only advances `Session`'s state on success, so a failure simply means nothing changed.
6. The existing `result.message` — whatever the failing state handler already produced — is displayed via the existing `onStep → refreshFromSession → api.setStatus(result.message)` path. No new message text is invented anywhere in Slideshow.
7. `onStopped` fires, `running` becomes `false`, and `applyMainControlsAvailability` re-enables Execute/Pass/Jump/Load Markdown/Play, returning full manual control to the operator.

**Failure categories considered and live-tested** (see §15 for exactly which were exercised and how):
- missing answer key (`MARK_CORRECT` with `question.correctAnswer` null on a UPSC-shaped paper),
- missing marking scheme configured (`PREPARE_FORM`'s `MarkingSchemes.getMarkingScheme()` returning `null`),
- Generate AI timeout (the 30-second `GENERATE_AI_TIMEOUT_MS` ceiling in `runGenerateAi()`),
- Save validation failure (Docxsity's own `.qm-error` messages, surfaced via `runSave()`'s existing logic),
- transient DOM failures (an element genuinely not found/not yet ready — the exact class of problem §11/§12 investigate).

**Slideshow intentionally does not distinguish between any of these.** The state machine already knows how to detect and report each one with its own specific message; Slideshow's only job is to notice `success: false` and stop. Building a taxonomy of failure types inside the controller — to decide "retry this kind, skip that kind" — was explicitly rejected as exactly the kind of scope creep §2 describes; it would also have required reading `result.retryable`, a field this project's own reconnaissance already established is dead data nowhere else in the codebase.

---

## 6. Control locking and race protection

### `applyMainControlsAvailability(hasQuestions)`

This function, added to `content/panel.js`, is the single source of truth for whether Execute, Pass, Jump, Load Markdown, Play, and Pause are enabled:

```js
function applyMainControlsAvailability(hasQuestions) {
  const slideshowRunning = window.ExamUploadAssistantSlideshow.isRunning();
  const notBusy = !isPanelBusy && !slideshowRunning;
  const manualEnabled = hasQuestions && notBusy;

  executeButtonEl.disabled = !manualEnabled;
  passButtonEl.disabled = !manualEnabled;
  jumpInputEl.disabled = !manualEnabled;
  jumpButtonEl.disabled = !manualEnabled;
  loadButtonEl.disabled = !notBusy;   // deliberately NOT gated on hasQuestions — see below

  if (playButtonEl) {
    const session = window.ExamUploadAssistantSession;
    playButtonEl.disabled = !hasQuestions || isPanelBusy || slideshowRunning || session.getCurrentState() === "COMPLETE";
  }
  if (pauseButtonEl) {
    pauseButtonEl.disabled = !slideshowRunning;
  }
}
```

**During an active Slideshow run** (`slideshowRunning === true`): Execute, Pass, Jump, and Play are all disabled (`manualEnabled` is `false` regardless of `hasQuestions`, since `notBusy` is `false`); Load Markdown is disabled for the same reason; Pause remains enabled. This is the entire mechanism preventing the concurrency/race scenarios this feature was explicitly required to close.

### Why Load Markdown was added to the guarded set

Before this feature, Load Markdown had **no guard at all** — it could be clicked at any time, including mid-automation. Loading a new file calls `Session.setRawMarkdown/setExamType/setQuestions/setCurrentState("IDLE")`, which would reset the question set and index **out from under** a running Slideshow loop that is mid-way through reading `Session.getCurrentQuestion()`/`Session.getCurrentState()` for its own in-flight `executeStep()` call — a strictly worse variant of the pre-existing Jump-during-Execute race (see [architecture.md](architecture.md)'s busy-guard section), since it discards the entire question set rather than just repositioning within it. Load Markdown's guard was found and added specifically because of this reasoning, not because it was part of the original Slideshow request.

**Load Markdown is deliberately not gated on `hasQuestions`** — unlike the other four controls, it must remain usable *before* any paper is loaded (that is its only purpose in that state) as well as after. Only `isPanelBusy`/`slideshowRunning` disable it. (An earlier draft of this fix incorrectly gated Load Markdown on `hasQuestions` too, which would have disabled the extension's very first action — found and corrected during live verification testing, see §15.)

### One shared code path, not three

`refreshFromSession()` (called after every manual Execute/Pass/Jump and after every Slideshow `onStep`), the Execute button's own `finally` safety net, and both the Play and Pause click handlers all call the exact same `applyMainControlsAvailability()` function — there is no second, parallel copy of this enable/disable logic anywhere. This was a deliberate refactor of what used to be two separate, duplicated `hasQuestions`-only blocks in the pre-Slideshow code.

### Settings remains ungated, intentionally

Settings' five controls (Marks/Penalty override toggles and values, the three feature toggles) are **not** added to the guarded set. This is intentional, not an oversight: Settings values are read fresh by each site's `runPrepareForm()`/`runMarkCorrect()`/`runGenerateAi()`/`runAddTags()` on *every* step, so changing a Settings value mid-run only affects whichever step executes next — it never mutates `Session`'s own structure (question list, index, current state) the way Load Markdown does. This is exactly the "no persistence, effect on the next step executed" model Settings was already designed around before Slideshow existed (see [decisions.md](decisions.md)'s Settings entry) — Slideshow simply inherits it for free, requiring no new code.

---

## 7. Docxsity vs. Modality — the capability design

```js
// sites/docxsity/stateMachine.js
supportsSlideshow: true,

// sites/modality/stateMachine.js
supportsSlideshow: false,
```

This is a **capability flag on the existing state-machine interface contract**, not hostname or domain detection. `content/panel.js` never inspects `location.hostname`, `location.href`, or any other site-identifying value anywhere in its code — it only ever asks the already-injected `window.ExamUploadAssistantStateMachine` object "do you declare `supportsSlideshow`?", the exact same pattern it already uses to ask that object "what are your `STATES`?". This preserves the project's long-standing rule (see [architecture.md](architecture.md)) that shared code must never contain an `if (isDocxsity)`-shaped branch.

**The flag controls two things**, both read once at panel-construction time in `content/panel.js`:
1. **Whether Play/Pause (and the restructured header/layout) are rendered at all** — `buildMarkup(shadowRoot, slideshowSupported)` branches on this single boolean for exactly three markup fragments (§8). On Modality this evaluates `false` and the Play/Pause elements are never created — they are absent from the DOM, not merely hidden (confirmed live, see §15).
2. **Whether `Slideshow.start()` will actually run** — `lib/slideshow.js`'s own `start()` re-checks `StateMachine.supportsSlideshow` itself (§2), independently of whatever the panel rendered. This is the defense-in-depth layer: even a direct console call to `window.ExamUploadAssistantSlideshow.start({})` on Modality — bypassing the UI entirely — is refused with `{started: false, reason: "unsupported"}`, confirmed live (§15).

### Why Modality is `false`

Docxsity's `GENERATE_AI` and `SAVE` states have real, observed completion waits (`runGenerateAi()`'s two-phase disabled/enabled check plus Explanation-content verification; `runSave()`'s `waitForDisappear` plus `.qm-error` reading). Modality's equivalents are click-only — they click the button and report success immediately, with no wait and no verification that anything happened (see [architecture.md](architecture.md)'s "why states verify completion" section and [docxsity.md](docxsity.md)'s GENERATE_AI/SAVE sections for the documented asymmetry). Driving Modality with a zero-delay automated loop would have no way to know whether an AI generation or a save had actually completed before moving on — exactly the reliability problem this whole feature exists to avoid. Rather than build new completion detection for Modality (a separate, unscoped project) or silently pretend the two sites have equivalent guarantees, Modality was scoped out entirely for this feature.

### Why one flag, not two

The Docxsity panel layout described in §8 (header repurposed into Load Markdown + gear, Play/Pause row inserted) exists **specifically to host the Slideshow controls** — there is no scenario in which a site would want that layout without Slideshow, or Slideshow without that layout change to make room for it. Introducing a second, independent `usesSlideshowPanelLayout` flag to track something that is definitionally the same fact as `supportsSlideshow` was considered and rejected as speculative generality with no concrete use case — consistent with this project's own stated preference for the smallest change that the actual evidence supports (see [decisions.md](decisions.md)).

---

## 8. Final Docxsity panel design

```
┌─────────────────────────────────────────┐
│ [        Load Markdown          ]   [⚙]  │   ← header row, also the drag handle
├─────────────────────────────────────────┤
│  File:      ...                          │
│  Question:  ...                          │
│  State:     ...                          │
├─────────────────────────────────────────┤
│  [   Play   ]      [   Pause   ]         │
├─────────────────────────────────────────┤
│  [        Execute Step         ]         │
├─────────────────────────────────────────┤
│  [         Pass Step           ]         │
├─────────────────────────────────────────┤
│  [ Question # ___ ]  [  Jump   ]         │
├─────────────────────────────────────────┤
│  Status:   ...                           │
│  [████████░░░░░░░░░░] progress           │
└─────────────────────────────────────────┘
```

Layout decisions, in order:
- The "Exam Upload Assistant" title is **removed** from the Docxsity header (it remains, unchanged, on Modality — §9).
- Load Markdown occupies the header's left side, in the slot the title used to fill — this required moving its markup from a standalone row into the header itself, done via a small conditional fragment in `buildMarkup()` (§7).
- The gear icon stays on the right, in its existing position, with **no change** to its own CSS — since the header's box model (block-level content + a fixed right-hand padding reservation, not a flex layout) was kept, the gear's existing absolute positioning needed no adjustment.
- Play/Pause is inserted as a new row **directly after** the State row and **before** Execute Step.
- Execute Step, Pass Step, and the Jump row keep their existing relative order and structure, unchanged.
- Status and the progress bar remain at the bottom, unchanged.

### Styling principle

**The existing dark panel color scheme (`#1e1e1e` panel background, `#2a2a2a` header, `#3b82f6` primary blue, `#3a3a3a` secondary gray, `#ffffff`/`#a0a0a0` text) is the only source of truth for this feature's visual design.** No new color, radius, shadow, font, or visual language was introduced anywhere:
- **Play reuses `.panel-execute-button`'s exact solid-blue treatment** (same visual role: the primary "go" action, same as Execute).
- **Pause reuses `.panel-pass-button`'s exact outlined treatment** (same visual role: the secondary/stopping action, same as Pass Step).
- **Load Markdown, in its new header position, reuses `.panel-load-button`'s existing colors/hover/active states** — only its box model (width/margin/padding, not color) was overridden for its new context, via a small `.panel-header-load-button` rule placed *after* `.panel-load-button`'s own rules in the stylesheet so the override actually wins the cascade.
- The Play/Pause row reuses the existing `.panel-jump-row` flex/gap pattern (the same two-column layout the Question-number/Jump row already used).

**Small final refinement**: the header's Load Markdown text initially sat flush against the panel's left edge, reading as visually cramped. A small left-padding addition (`padding: 8px 36px 8px 8px`, reusing the `8px` value already present in that same rule for top/bottom padding rather than introducing a new number) gives it breathing room, with no other property changed.

---

## 9. Modality remains unchanged

Modality's panel keeps its original structure, verified live (§15) to be present:

```
┌─────────────────────────────────────────┐
│ Exam Upload Assistant               [⚙]  │
├─────────────────────────────────────────┤
│  [        Load Markdown         ]        │
│  File:      ...                          │
│  Question:  ...                          │
│  State:     ...                          │
├─────────────────────────────────────────┤
│  [        Execute Step         ]         │
├─────────────────────────────────────────┤
│  [         Pass Step           ]         │
├─────────────────────────────────────────┤
│  [ Question # ___ ]  [  Jump   ]         │
├─────────────────────────────────────────┤
│  Status:   ...                           │
│  [████████░░░░░░░░░░] progress           │
└─────────────────────────────────────────┘
```

- The "Exam Upload Assistant" title, the gear, and the standalone Load Markdown row all remain exactly where they were.
- **There is no Play/Pause row.** `buildMarkup(shadowRoot, false)`'s conditional fragments for the header content, the group-related Play/Pause row, and (on the header side) the standalone-row placement all resolve to their non-Slideshow branch, so the Play/Pause markup string is never generated.
- **Play/Pause elements are absent from the DOM, not merely hidden with CSS** — confirmed live via `document.querySelector('[data-field="play-button"]') === null` (§15), not inferred from the code alone.
- The existing manual Execute/Pass/Jump/Load workflow on Modality is unchanged in every respect — no file under `sites/modality/*` other than the one-line `supportsSlideshow: false` addition was touched by this feature.

---

## 10. The timing problem — an architectural lesson

Once Slideshow's control-locking and failure-policy logic worked correctly, live testing on Docxsity surfaced a *different* class of problem: the automation would fail intermittently with "element not found"/timeout-style errors that never occurred during manual use. Manual Execute Step testing had already passed; the state-machine logic itself was not wrong.

**The initial, rejected instinct was to add a small fixed delay between Slideshow's automated steps** (e.g. a flat `sleep(50)` or `sleep(100)` before each `executeStep()` call). This was explicitly investigated and rejected before implementation, for reasons detailed in §13.

**Instead, live reconnaissance was performed directly against the real Docxsity site**, using:
- disposable test question banks (created and deleted for each investigation — never a real paper bank),
- the actual DOM, driven via the real `sites/docxsity/domHelpers.js` primitives (injected into the live page and exercised directly, not a separate reimplementation),
- **zero artificial delay** between simulated steps — deliberately reproducing exactly what `lib/slideshow.js`'s tight loop does, which is meaningfully different from how the original reconnaissance for this project had always operated (every prior manual test had natural tool-round-trip pauses between actions that behaved, by accident, like a slow human),
- direct timing measurement (`performance.now()`) and, where appropriate, `MutationObserver`-based polling to capture the *exact* moment a DOM condition became true, not just before/after snapshots.

The investigation showed that **different UI elements become ready at different times**, and that this only matters when nothing separates two automated actions by more than that gap — exactly the situation Slideshow's zero-delay loop creates and manual clicking never did. Two distinct races were found this way (§11, §12). The resolution in both cases was the same design principle:

> **Wait for the actual DOM condition you need, rather than waiting an arbitrary amount of time.**

This principle should be treated as load-bearing for any future automation work on this project — see §18.

---

## 11. Race #1 — TinyMCE trigger-button readiness

**Finding**: a freshly-created TinyMCE-backed rich-text field's own container (an option card, a fresh Question-Group Sub Question card, or the Add Question modal itself) becomes queryable in well under 1ms after the triggering click, but that same field's own "Paste Raw Markdown" toolbar button — the element `pasteMarkdown()` actually needs to click next — takes measurably longer to exist.

**Measured lag** (live, multiple samples, real Docxsity):
- A freshly-created option card's own trigger button: **~34–55ms** after the card container itself was already queryable (three samples: 53.7ms, 34.8ms, 33.8ms).
- The Question Text field's own trigger button, on a freshly-opened Add Question modal: **~53ms** after the modal container was already queryable.
- By contrast, plain Angular controls in the same containers (the Question Type `ng-select`, the Marks input, the "Mark as Correct" button) were confirmed available with **zero** measured lag — the delay is specific to TinyMCE's own per-field initialization, not a general "still rendering" phenomenon.

**Why manual Execute Step never surfaced this**: a human's own reaction time between one click and the next is, in practice, always well over the ~34–55ms gap — the race is invisible by accident of human slowness, not because the underlying code was correct for the fast-path case.

**Fix** — `sites/docxsity/domHelpers.js`, inside `pasteMarkdown()`:
```js
const waitTriggerResult = await waitForElement(triggerButton, options);
if (!waitTriggerResult.success) {
  return waitTriggerResult;
}
const clickTriggerResult = clickElement(triggerButton, options);
```
This reuses the already-existing `waitForElement()` primitive (same default timeout, no new selector, no new mechanism), inserted immediately before the pre-existing `clickElement(triggerButton, options)` call. **This one change, in one function, covers every TinyMCE-backed field on Docxsity** — Question Text, every Option, a Question Group's shared Instruction/Title field, and any freshly-created Sub Question card's own Question Text field — because `pasteMarkdown()` is the single shared composition every one of those call sites already goes through. No separate fix was needed (or added) at any of those call sites.

See [debugging-notes.md](debugging-notes.md) for the full investigation record, including the live reproduction steps.

---

## 12. Race #2 — post-Save "Add Question" button readiness

**Finding**: immediately after clicking "Save Question," Docxsity's underlying page transitions between two view states (a "modal open" state and the "Questions List" state) as part of returning to the list and reflecting the newly-saved question. During this transition, the top-level "Add Question" button briefly does not exist in the DOM.

**Critically, this transition is not synchronized with the modal's own close signal.** Live timeline reconnaissance (a passive `MutationObserver` recording every relevant DOM change after a Save click, with no click of "Add Question" attempted until the recording was analyzed) showed, in one representative trial:
- Save clicked at t = 0.
- "Add Question" button count drops to 0 at **t ≈ 393ms — while the Add Question modal was still visibly open.**
- The modal itself is confirmed gone (the existing `waitForDisappear` completion signal) at **t ≈ 720ms.**
- The "Add Question" button reappears, together with the "Questions List" container, in the **same** DOM mutation, at **t ≈ 758ms.**

**Measured gap between modal-close and button-reappear: ~38ms** in that trial; a second independent trial measured the same gap directly via `waitForElement()` timing as **~43ms**. Both trials reproduced the original "element not found" failure when the click was attempted at the exact moment `waitForDisappear(addQuestionModal)` resolved. **The modal disappearing is therefore not, by itself, sufficient evidence that the "Add Question" button is ready** — they are two independent signals of the same underlying page transition, and the second one lags the first by tens of milliseconds.

**Fix** — `sites/docxsity/stateMachine.js`, inside `ensureQuestionFormReady()`, before the existing standalone-question click:
```js
const addQuestionButtonReady = await DomHelpers.waitForElement(selectors.addQuestionButton);
if (!addQuestionButtonReady.success) {
  return addQuestionButtonReady;
}
const clickResult = DomHelpers.clickElement(selectors.addQuestionButton);
```
The identical pattern was applied to the Question-Group entry point, immediately before its own pre-existing click:
```js
const addQuestionGroupButtonReady = await DomHelpers.waitForElement(groupSelectors.addQuestionGroupButton);
if (!addQuestionGroupButtonReady.success) {
  return addQuestionGroupButtonReady;
}
const clickGroupResult = DomHelpers.clickElement(groupSelectors.addQuestionGroupButton);
```
Both reuse the existing `waitForElement()` primitive and existing selectors — no new selector, no new timeout value, no retry logic. **No arbitrary sleep was added anywhere in either fix.**

See [debugging-notes.md](debugging-notes.md) for the full investigation record.

---

## 13. Why generic delays were rejected

A single fixed delay applied uniformly between every Slideshow step (or before every question) was considered and explicitly rejected, for reasons established directly from the measurements in §10–§12, not as a general stylistic preference:

- **Most states don't need it at all.** `MARK_CORRECT`, `ADD_TAGS`, and every fast TinyMCE paste cycle *other* than the specific freshly-created-field case resolve in low single-digit milliseconds — a blanket delay would tax every one of these for no reason.
- **Different operations have measurably different readiness times** (~34–55ms for a TinyMCE trigger button, ~38–43ms for the post-Save Add Question button, several *seconds* for Generate AI and Save) — no single fixed number is simultaneously large enough to cover the slowest case and small enough not to waste time on the fastest.
- **Generate AI and Save already contain their own real completion waits** (the two-phase disabled/enabled check; `waitForDisappear` plus `.qm-error` reading) — an additional fixed delay around them would be pure waste on top of already-correct logic.
- **A fixed delay large enough for today's measurements could still be too short** under a slower page load, a slower network, or a busier browser — the measured numbers in this document are evidence of what was observed, not a guaranteed upper bound (the same caution this project's own documentation already applies to every other live timing measurement — see [docxsity.md](docxsity.md)'s Generate AI section).
- **A condition-based wait costs nothing when the condition is already true** — every `waitForElement()` call added by these two fixes resolves in the same tick when the target already exists, which is the common case; it only "spends" time in the specific, narrow window where it's genuinely needed.

The final architecture therefore uses targeted, per-element readiness checks — reusing the same `waitForElement()` primitive both fixes needed — rather than any delay applied at the loop or step level.

---

## 14. Generate-with-AI auto-scroll

**Requirement**: whenever `GENERATE_AI` executes — via manual Execute Step or via Slideshow — scroll the "Generate with AI" button into view if it's currently outside the visible viewport, and do nothing if it's already visible.

**Implementation** — entirely inside `runGenerateAi()` in `sites/docxsity/stateMachine.js`, using the same `buttonSelector`/`root` the function already resolves for its existing click:
```js
function isElementInViewport(element) {
  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  return rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
}
// ...inside runGenerateAi(), before the existing click:
const generateButtonElement = DomHelpers.findElement(buttonSelector, root);
if (generateButtonElement && !isElementInViewport(generateButtonElement)) {
  generateButtonElement.scrollIntoView({ block: "center" });
}
```

Placing this inside `runGenerateAi()` (rather than `lib/slideshow.js`) means both manual Execute Step and Slideshow's automated `executeStep()` calls receive it identically, from the same code path, with no Slideshow-specific branch anywhere.

**Discovery made while implementing this**: the "Generate with AI" button lives inside Docxsity's own internally-scrollable modal content div (`.modal-body.qm-body`, confirmed live with `scrollHeight: 3223` against a `clientHeight` of `590`) — the outer page (`document.body`) has `overflow-y: hidden` and never scrolls while the modal is open. `getBoundingClientRect()` already returns viewport-relative coordinates regardless of which ancestor is the actual scrolling container, and the native `element.scrollIntoView({block: "center"})` already handles scrolling an arbitrarily-nested scrollable ancestor correctly — so no special handling for the nested-scroll case was needed beyond using these two standard mechanisms correctly.

**No delay was introduced.** The viewport check and the conditional scroll are both fully synchronous; the only `await`s in `runGenerateAi()` remain the pre-existing disabled/enabled waits, entirely untouched. The existing selector (`Selectors.generateAi.generateButtonSelector`), the existing click, the existing two-phase wait, the existing `GENERATE_AI_TIMEOUT_MS` value, and the existing Explanation-content verification are all unchanged.

---

## 15. Verification

**Read this section's claims carefully — what was directly observed vs. what was reasoned from a smaller, related test is distinguished explicitly below, matching this project's own established documentation discipline (see [nda-gat.md](nda-gat.md)'s validation sections for the precedent).**

**Methodology note, stated plainly**: Claude's browser-automation tooling could not reach the real, installed extension's content-script globals on the live Docxsity site in this environment (the same limitation already documented in [nda-gat.md](nda-gat.md) §5 for a prior feature). Live verification of Slideshow's control-flow logic (Play/Pause lifecycle, control locking, failure handling) was therefore performed using a local test harness that loads the **real, unmodified `lib/session.js`, `lib/settings.js`, and `content/panel.js`/`panel.css`**, plus a stubbed `StateMachine`/`Loader`/`Parser` (since those legitimately require either a live Docxsity DOM or a real file-picker dialog neither this tool nor the panel's own code paths differ on). Live verification of the two DOM-timing fixes (§11, §12) and the auto-scroll addition (§14) was performed directly against the real Docxsity site using disposable banks, with the real `sites/docxsity/domHelpers.js` injected and exercised directly; for the state-machine orchestration layer in those tests, a line-for-line faithful reproduction of the actual `ensureQuestionFormReady()`/`runGenerateAi()` logic was used (verified against the real diff) rather than the literal file, because the literal file's size exceeded a tool-side limit on single-line base64 injection. This is stated here so the distinction is not lost to session memory.

**Completed verification:**

- **Manual Execute Step regression** — full load → repeated Execute cycle, confirmed unaffected by the control-locking refactor (identical enable/disable behavior when Slideshow has never run).
- **Play/Pause full lifecycle** — Play locks Execute/Pass/Jump/Load/Play instantly and enables Pause; a full multi-question run completes and stops correctly.
- **Completion at `COMPLETE`** — a full run against a 3-question paper stopped automatically at `COMPLETE`, with Play correctly staying disabled there afterward (not just Pause).
- **Pause during a slow Generate AI operation** — Pause clicked mid-flight; the in-flight step ran to its own natural completion (never interrupted), the loop then stopped *before* the next state, and Session was preserved exactly at that point; a subsequent manual Execute Step correctly resumed from there.
- **Failure handling** — a failure injected at `MARK_CORRECT` stopped the run exactly there, showed the exact underlying failure message, left `Session`'s index/state untouched, and restored manual control — no retry, no auto-Pass.
- **Manual-control locking / defense-in-depth** — with a run active, Execute/Pass/Jump/Load Markdown were force-enabled (bypassing the `disabled` attribute) and clicked directly; all four logged "UNCHANGED (guard held)" — the explicit in-handler `isPanelBusy || Slideshow.isRunning()` check, not just the DOM `disabled` state, was confirmed to block them.
- **Load Markdown protection** — confirmed as part of the same force-click test above, and separately confirmed that Load Markdown remains usable *before* any paper is loaded (the bug where it was incorrectly gated on `hasQuestions` was found and fixed during this same verification pass).
- **Docxsity visual layout / dark theme** — confirmed via screenshot: header shows Load Markdown + gear (no title), Play/Pause between State and Execute, Play/Pause using Execute's/Pass's existing color treatments, dark palette intact, no white anywhere.
- **Modality unchanged** — confirmed via screenshot and direct DOM query: title present, Load Markdown in its own standalone row, Play/Pause elements **absent from the DOM** (`querySelector` returns `null`, not just hidden).
- **Direct Modality Slideshow rejection** — a direct console call to `Slideshow.start({})` on the Modality-shaped panel returned `{started: false, reason: "unsupported"}`.
- **TinyMCE fresh-field readiness** — measured directly (§11): option-card trigger buttons and a fresh-modal Question-Text trigger button, with precise before/after timing.
- **Question Group entry path** — with the readiness fix applied: `addQuestionGroupButton` wait, click, group modal appear, shared-instruction paste, "Add Sub Question," and a paste into the freshly-created sub-question's own Question Text field all succeeded — tested immediately after a run of standalone questions, i.e. in the same post-Save transition window that previously caused failures.
- **Post-Save → Add Question race** — reproduced twice before the fix (both times failing identically); confirmed resolved after the fix via **5 consecutive standalone questions, back-to-back, with zero artificial delay between any of them** — all 5 completed the full `PREPARE_FORM → PASTE_QUESTION → PASTE_OPTIONS → MARK_CORRECT → GENERATE_AI → SAVE` cycle with no failures (individual cycle times: 5876ms, 5485ms, 5646ms, 4083ms, 4188ms), specifically crossing the `SAVE → PREPARE_FORM` boundary successfully all 4 times it occurred.
- **Generate AI already-visible case** — confirmed the readiness/scroll check produces **zero** change in the modal's internal `scrollTop` when the button is already in view (measured identical before/after).
- **Generate AI out-of-viewport case** — confirmed the button's real, unforced starting position (`top: 2766px` against a `780px` viewport) was correctly detected as out-of-view and correctly scrolled to a centered, in-view position.
- **Full Generate AI → Save flow after auto-scrolling** — a real question was driven through the auto-scroll, a real AI generation (content verified: "Topic... Basic Addition... Correct Answer... The correct option is 2..."), and a real Save, all completing successfully with no behavior change beyond the scroll itself.

**Explicitly not tested, stated honestly rather than implied:**
- The literal, installed browser extension's Play/Pause buttons were never clicked through Claude's own browser tooling on the live site (the stated environment limitation above) — verification of the panel/controller logic relied on the harness methodology described, and verification of the two DOM races relied on driving the real `domHelpers.js` directly rather than through the literal panel UI.
- Manual Execute Step was not independently re-clicked live for the post-Save race fix or the auto-scroll fix specifically — its unaffected status is inferred from the fact that both fixes are pure "wait only if needed" additions that resolve in the same tick under any realistic human timing, the same reasoning already applied to the TinyMCE fix's own manual-path argument.
- No load-testing or measurement was done under a slower network/CPU than what was available during these sessions — the specific millisecond figures in §11/§12 are what was actually observed, not a guaranteed bound (see §13).

---

## 16. File responsibilities

| File | Responsibility for this feature |
|---|---|
| `lib/slideshow.js` | Slideshow orchestration only: `isRunning`/`start`/`pause`, the `executeStep()` loop, `onStep`/`onStopped` callbacks, the `supportsSlideshow` defense-in-depth check. No DOM, no selectors, no site-specific logic of any kind. |
| `manifest.json` | Loads `lib/slideshow.js` into both content-script entries (Docxsity and Modality), alongside `lib/session.js`/`lib/settings.js`. |
| `sites/docxsity/stateMachine.js` | `supportsSlideshow: true`; the `addQuestionButton`/`addQuestionGroupButton` readiness waits inside `ensureQuestionFormReady()` (§12); the Generate-AI viewport check and conditional scroll inside `runGenerateAi()` (§14). All pre-existing state logic in this file is otherwise unchanged. |
| `sites/docxsity/domHelpers.js` | The `pasteMarkdown()` trigger-button readiness wait (§11) — the only change in this file for this feature. |
| `sites/modality/stateMachine.js` | `supportsSlideshow: false` — the only change in this file for this feature. |
| `content/panel.js` | The restructured `buildMarkup()` (capability-conditional header/Load-Markdown/Play-Pause fragments), Play/Pause element lookup and wiring, `applyMainControlsAvailability()`, the Load Markdown guard and its header `mousedown` stop-propagation. |
| `content/panel.css` | `.panel-header-load-button`, `.panel-play-button`/`.panel-pause-button` sizing rules (reusing existing color rules), the extended `:disabled` selector list. No new colors/fonts/shadows. |

**Confirmed untouched by this feature** (verified via `git diff`/`git show --stat` across every commit and working-tree change involved, not merely assumed):
- `sites/docxsity/selectors.js`
- `sites/docxsity/domHelpers.js` — except for the one documented change in §11; everything else in that file, including its own pre-existing `scrollIntoView()` helper, is untouched (the Generate-AI auto-scroll in §14 deliberately does not use it, to avoid touching a shared helper other call sites also rely on — see §14).
- `sites/modality/selectors.js`
- `sites/modality/domHelpers.js`
- `lib/session.js`
- `lib/settings.js`
- `lib/parser.js`
- `content/loader.js`
- `content/content.js`
- `background.js`

---

## 17. Current final architecture

```
Manual Execute Step
    |
    v
StateMachine.executeStep()
    |
    +-- existing state logic (PREPARE_FORM ... SAVE ... NEXT_QUESTION)
    |
    +-- targeted DOM readiness waits (§11 TinyMCE, §12 Add Question)
    |
    +-- Generate AI auto-scroll (§14)


Play
    |
    v
Slideshow.start()
    |
    +-- while (true): StateMachine.executeStep()   <-- the SAME call above
    |
    +-- onStep -> refreshFromSession (panel update)
    |
    +-- !success -> stop, reason "failed"
    |
    +-- stopRequested (from Pause) -> stop, reason "paused", checked only between iterations
    |
    +-- Session.getCurrentState() === "COMPLETE" -> stop, reason "complete"
```

**The single property to preserve in any future work on this feature: manual and automated execution call the exact same `StateMachine.executeStep()`, with the exact same state logic, the exact same readiness waits, and the exact same DOM interactions.** Slideshow adds a loop and a stop condition around that call — it does not, and must not, grow a second way of doing anything `executeStep()` already does.

---

## 18. Future debugging rules

If another automation failure appears (in Slideshow or in a future feature built the same way), follow this order — the exact process that found and fixed both races in this document:

1. **Do not immediately add a generic delay.**
2. Reproduce the failure with a live-DOM test that has **zero artificial delay** between actions — a test with any natural pause between steps may not reproduce a race that only exists at automation speed.
3. Identify the exact state (`PREPARE_FORM`, `PASTE_OPTIONS`, etc.) where the failure occurs.
4. Identify the exact DOM operation that failed (which selector, which click, which wait).
5. Measure — with `performance.now()` and/or a `MutationObserver`, not a guess — exactly when the element or condition the failing operation needed actually becomes available.
6. Determine whether an existing readiness primitive (`waitForElement`, `waitForDisappear`) already solves it once placed at the right point — in every case found so far, it did.
7. Add the smallest targeted readiness condition, at the correct abstraction layer: inside the shared primitive (`domHelpers.js`) if every caller of that primitive needs it (§11's precedent), or inside the specific state handler (`stateMachine.js`) if only that one call site does (§12's and §14's precedent). Never inside `lib/slideshow.js`.
8. Re-test manual Execute Step — confirm the fix is invisible to normal human-speed use (it should resolve in the same tick).
9. Re-test Slideshow — confirm the original failure no longer reproduces under the same zero-delay conditions that found it, ideally across several consecutive questions, not just one.
10. Confirm Modality remains unaffected, by file scope (`git diff`) if the fix was Docxsity-specific, or by explicit test if it touched genuinely shared code.

The goal is to preserve this feature's central property: **every wait in this codebase is a wait for something real, never a wait for an arbitrary amount of time.**
