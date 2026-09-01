# Docxsity Debugging Notes

Investigations that produced durable architectural knowledge — not a log of every temporary diagnostic added and removed along the way. See [architecture.md](architecture.md) for how these findings shaped the current design, and [docxsity.md](docxsity.md) for where each finding is reflected in a specific state.

---

## Windows PASTE_QUESTION timeout (aria-label vs. aria-labelledby)

**Symptom:** the standalone pipeline worked end-to-end on macOS. On Windows, `PREPARE_FORM` succeeded but `PASTE_QUESTION` consistently timed out waiting for the "Paste Markdown Data" dialog, using the selector `[role="dialog"][aria-label="Paste Markdown Data"]`.

**Investigation, in order:**

1. **Ruled out manually first.** A manual click-through on Windows (real user interaction, no automation) opened the dialog correctly — ruling out a genuine site-level failure on that platform before touching any code.
2. **First diagnostics attempt produced zero console output on Windows.** This initially looked like a diagnostic-placement bug. It turned out to be a cross-machine git-sync issue, not a code issue — the diagnostics were still uncommitted local changes that had never reached the Windows machine. (This is a process lesson, not a Docxsity-specific one — noted separately below.)
3. **Once synced, diagnostics confirmed the click was not the problem.** Instrumentation around the trigger click and the dialog wait showed: the button was found and clicked, `document.activeElement` moved into the dialog's textarea, and — critically — a `.tox-dialog` element existed on the page (`toxDialogCount: 1`) while the exact selector still failed to match (`exactSelectorFound: false`). This isolated the failure to the selector itself, not the click or the dialog's opening.
4. **Instrumented the dialog's actual attributes on Windows.** A full attribute dump of the `.tox-dialog` element showed it carried `aria-labelledby="dialog-label_..."` pointing at its own `<h1>`, with **no `aria-label` attribute at all** — unlike macOS, where the same dialog carried `aria-label="Paste Markdown Data"` directly.

**Root cause:** TinyMCE's dialog accessible-name wiring (`aria-label` vs. `aria-labelledby` + a referenced heading) is not stable across environments for the same dialog instance. A selector requiring `[aria-label=...]` silently never matches on Windows, even though the click and the dialog itself both work correctly there.

**Why macOS and Windows differed:** not conclusively determined beyond the observed attribute difference — the dialog's own rendering path evidently picks one accessible-naming strategy or the other depending on the environment. What *is* confirmed: the visible title text is stable on both platforms — `<h1 class="tox-dialog__title">Paste Markdown Data</h1>` inside `.tox-dialog`, verified live on macOS specifically (not merely assumed transferable from the Windows report).

**Fix:** changed `markdownImportModal.container` in `sites/docxsity/selectors.js` from
```js
'[role="dialog"][aria-label="Paste Markdown Data"]'
```
to
```js
{ tag: "h1", text: "Paste Markdown Data", closest: ".tox-dialog" }
```
A one-line, structural-selector change — no change to `domHelpers.js`, timing, retries, or any other selector. Verified independently on macOS before shipping (not assumed correct from the Windows finding alone), then confirmed fixed on Windows.

**Lesson:** prefer selectors anchored to stable visible text/structure over accessibility attributes that a framework may wire differently per environment. This is now the standing selector preference recorded in [architecture.md](architecture.md).

---

## Cross-machine debugging: verify the diagnostic commit reached the other machine

**Symptom:** the first round of Windows diagnostics (see above) produced no console output at all — looked identical to a diagnostic-placement bug.

**Investigation:** `git log origin/main..HEAD` on the Mac session returned empty — meaning the Mac's `main` had already been fully pushed to `origin` *before* the diagnostics were added locally. The diagnostics were still sitting as uncommitted local changes on the Mac, never reaching Windows via `git pull` at all.

**Root cause:** not a logic or placement bug — confirmed by literally tracing every `diag()` call site through `runPasteQuestion()` → `pasteMarkdown()` → `clickElement()` and finding each one correctly placed before any code that could fail. The diagnostics were simply never present on the machine being tested.

**Lesson:** when a symptom can only be reproduced on a machine without direct access (Windows, in this project — `claude-in-chrome` only drives the local/Mac browser), the loop is: write diagnostics → commit → push → the other machine pulls and tests → results are reported back. Before concluding "the diagnostics are broken" from a report of zero output, verify the diagnostic commit actually reached `origin` (or ask). Also worth knowing: not every commit in this project's history was authored via a Claude Code tool call — the user sometimes commits/pushes changes directly when they need something on the other machine quickly (seen with the actual selector fix commit, which carried the terse message "test2").

---

## PASTE_OPTIONS option-card count discrepancy

**Symptom:** a specific reconnaissance session observed 1 existing option card when `PASTE_OPTIONS` began; a separate report described 4. This looked at first like an inconsistency worth chasing down as a bug.

**Investigation:** confirmed live that Docxsity's Question Type `ng-select` control itself resizes the underlying options array whenever it is actively selected through a real UI event — selecting "Fill Blank" collapses option cards to 0, selecting "MCQ Choice" back-populates exactly 4 empty cards, both directions immediate with no timing gap, never restoring prior content. Because `selectDropdown()` is idempotent (it only performs a real click when the control's current displayed value already differs from the target), whether this resize has fired by the time `PASTE_OPTIONS` runs depends on that particular Add Question modal's accumulated Question Type interaction history within the session — not on any bug in the automation.

**Conclusion:** not a bug. `ensureOptionCount()` (see [docxsity.md](docxsity.md)) was already written to handle either starting point correctly, since it checks each position independently rather than assuming a fixed baseline count. No code change was made — only the surrounding comment in `selectors.js` was corrected to describe this as expected site behavior rather than an assumed fixed default.

---

## Execute Step re-entrancy (panel-wide, not Docxsity-specific)

**Investigation trigger:** an explicit request to trace, not speculate on, whether anything prevented a second Execute Step click (or a Pass Step / Jump click) from running while an Execute Step was already in flight.

**Finding, by literal code trace:** `executeStep()` is async and can be mid-flight for milliseconds to tens of seconds (a `GENERATE_AI` step in particular). `Session`'s current state is not written until the in-flight handler resolves. Nothing in the original `content/panel.js` prevented a second Execute Step click from reading the same still-current state and re-dispatching to the same handler, or Pass Step/Jump from mutating `Session` concurrently with whatever the in-flight handler was still doing against the live page. Also confirmed by grep: the `retryable` field is set on every result throughout both state machines but never actually read by any caller.

**Resolution:** a single panel-wide busy guard was added to the shared `content/panel.js`, not to either site's state machine — see [architecture.md](architecture.md) for the guard's design and [decisions.md](decisions.md) for why it belongs in shared code. This was a real, previously-unnoticed bug affecting both Modality and Docxsity equally; it surfaced specifically because the trace was done against the literal code rather than reasoned about conceptually.

---

## Docxsity Question Group cards: the one button on a collapsed card removes it, it does not expand it

**Symptom/context:** while live-testing the Question Group runtime (Phase 4B, against real NDA data), a collapsed `.qm-sq-card` (an earlier group member, automatically collapsed once a later member's card was created — see [docxsity.md](docxsity.md)'s accordion note) was found to render down to essentially one icon button. Clicking that button, expecting it to re-expand the card for inspection, instead **deleted that sub-question from the group** — its `title` attribute reads `"Remove Sub Question"` (class `qm-icon-btn--danger`), confirmed by inspecting the button's own markup immediately after the click.

**What this means practically:** on a collapsed group card, there is currently no confirmed way to re-expand it and inspect/re-edit its fields directly — the only interactive control found on a collapsed card is destructive. This matters for anyone doing further live/manual investigation of this UI: do not click a collapsed card's lone button assuming it's a disclosure toggle.

**What was confirmed as a side effect:** deleting a mid-group card correctly relabels the remaining cards' letters (e.g. removing "a" from a 3-member group relabels the former "b"/"c" down to "a"/"b") and **the remaining cards' own data survives the relabeling** — inspected directly after the accidental deletion. This is incidental evidence for (not the primary basis of) the "collapsed cards retain their data" claim in [docxsity.md](docxsity.md) — the primary evidence is that every multi-member group tested saved correctly as a whole with earlier members long collapsed.

**Not investigated further:** whether a genuine, non-destructive expand control exists elsewhere in Docxsity's UI (a different click target, a keyboard interaction, etc.) was out of scope for that test session and was not chased down. Recorded here so the same accidental click isn't repeated by a future session.

---

## Docxsity's Question Type ng-select silently renamed its MCQ label, surfacing as "buttons disabled, no error" rather than a parse failure

**Symptom:** while preparing to live-test GAT, a loaded Markdown file showed "Markdown Loaded" in the panel status and a correct filename, but the question counter read "0 / 0" and Execute Step/Pass Step/Jump were all disabled — with no error message anywhere explaining why.

**Investigation, in order:**

1. **Traced the panel's own enable/disable logic first**, not assumed. `content/panel.js`'s `refreshFromSession()` disables all four controls purely on `session.getTotalQuestions() === 0` — and, critically, the status text it shows after a load is the *loader's* own success message (`"Markdown Loaded"`), not anything derived from `parseDocument()`'s result. This is why a zero-question parse produces no visible error at all: the loader genuinely did succeed at reading the file; only the parse afterward produced nothing.
2. **This narrowed the question to why `parsed.questions.length` was 0** for a file already statically verified (via a Node harness, independent of the browser) to parse to 150 questions with the current code on disk. Two live candidates: a stale, unreloaded extension bundle (Chrome doesn't hot-reload unpacked-extension source on save), or a title-detection mismatch on the specific file loaded.
3. Separately, live DOM inspection of Docxsity's Question Type control (unrelated at first, done for GAT reconnaissance) found its displayed default value read `"Multiple Choice Question"`, not the `"MCQ Choice"` value `sites/docxsity/selectors.js` had recorded from an earlier verification pass. Opening the dropdown listed 6 options where only 5 had been documented, with a new `"Multiple Select Question"` entry.

**Root cause:** Docxsity's own live UI renamed the MCQ option's label (and added a new option) at some point after the original `selectors.js` verification — a site-side change, not caused by anything in this project. `DomHelpers.selectDropdown()`'s idempotent shortcut (skip clicking if the control already displays the target value) meant this didn't manifest as an obvious dropdown-selection failure: the control's real default already matched what was wanted, it just didn't match the *stale string* `runPrepareForm()` was comparing against, so `PREPARE_FORM` would have gone on to search for a nonexistent `.ng-option` and time out — a separate, later symptom from the "0 questions loaded" one above, which actually traced back to something else (a title-detection/stale-bundle question resolved independently, not this label rename itself).

**Fix:** a single constant update in `sites/docxsity/selectors.js` (`MCQ_OPTION_VALUE`). See [decisions.md](decisions.md) for the full "why" and the general lesson about selector values needing periodic re-verification, and [nda-gat.md](nda-gat.md) §4 for the Docxsity-wide (not GAT-specific) scope of this fix.

**Lesson:** when a loaded file produces no visible error but also no usable session, check the panel's own status-text plumbing before assuming the parser is at fault — `panel.js` currently has no code path that distinguishes "loaded, parsed to zero questions" from "loaded, parsed fine," and both look identical in the UI. A quick console check (`window.ExamUploadAssistantSession.getTotalQuestions()`, `window.ExamUploadAssistantParser.detectExamType(...)`) is faster than assuming either the parser or the site is broken.

---

## Docxsity's markdown renderer misinterprets text starting with "pie" as a Mermaid diagram (informational — not a project bug, not fixed, not worked around)

**This is filed here as a durable, external fact worth knowing before it's rediscovered as a mystery — not as an issue this project owns or has any open action item for.**

**Symptom:** during Phase 4B live validation, NDA question Q104's real Option D text — the literal string `"pie chart"` — was pasted via Docxsity's standard "Paste Raw Markdown" → "Render & Insert" flow (the same `pasteMarkdown()` call path used successfully for every other field in this project). The paste reported success (dialog closed normally, no error at paste time), but the option's actual rendered content became the string `"Error rendering flow chart"` instead of the pasted text. This was only discovered later, when Docxsity's own SAVE validation rejected the option as empty (`"Option text is required."`).

**Root cause, confirmed via the browser console:**
```
Parsing failed: Lexer error on line 1, column 5: unexpected character: ->c<- at offset: 4, skipped 5 characters.
```
Offset 4 is immediately after `"pie "`; the unexpected character is `c`, from `"chart"`. Docxsity's rich-text renderer evidently auto-detects text beginning with the word **"pie"** as the start of a Mermaid.js `pie`-diagram declaration — even with no code fence present — attempts to parse the remainder as Mermaid pie-chart syntax, fails, and silently substitutes a generic error string in place of the actual content, with no error surfaced at paste time.

**Reproduced 3 times independently** (the original paste, plus two manual re-pastes into two different option cards in the same modal) — always the identical result for text starting with "pie." A control paste of `"bar chart TEST"` into the same modal, same session, succeeded normally — ruling out a general "chart"-keyword trigger, a stale-textarea bug in `pasteMarkdown()`, or a session-wide rendering-pipeline glitch. The trigger is specifically text beginning with "pie."

**Why this is not treated as a project defect:** the corruption happens entirely inside Docxsity's own third-party markdown/rich-text renderer, on content this project's `pasteMarkdown()` correctly delivered (click, fill, confirm — every step completed and was observed to complete). `runPasteOptions()`'s own success signal (a completed paste-and-dialog-close cycle) has no way to detect a renderer silently substituting different content after the fact — the only place this becomes visible is later, at SAVE, via Docxsity's own required-field validation, which correctly rejects the corrupted result. A human manually pasting `"pie chart"` into the same field, with no automation involved, would hit the identical failure.

**Explicitly not done, on direct instruction:** no scan of other NDA questions (or any other exam's content) for other Mermaid-keyword collisions (`graph`, `flowchart`, `sequenceDiagram`, `gantt`, `classDiagram`, `stateDiagram`, `erDiagram`, `journey`, etc.); no workaround, sanitization, or escaping added to `pasteMarkdown()` or anywhere else; no attempt to detect this failure class earlier (e.g. reading back the pasted content to verify it matches what was sent). See [nda-mathematics.md](nda-mathematics.md) §7 for the full incident record as it applies to Q104 specifically.
