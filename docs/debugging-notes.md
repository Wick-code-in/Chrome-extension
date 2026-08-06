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
