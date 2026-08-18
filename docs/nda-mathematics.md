# NDA & NA Mathematics Support

This document covers the `NDA_MATHEMATICS` exam type end to end: why it needed its own parser path, exactly how that path works, what was verified and how, and what remains unverified or out of scope. It is the source of truth for this feature — prefer this over any session memory when the two disagree.

Related documents: [docxsity.md](docxsity.md) covers the Docxsity Question Group *runtime* this feature drives (built as part of the same change, but usable by any exam type with `group` metadata, not NDA-specific). [decisions.md](decisions.md) covers the "why" behind specific choices. [debugging-notes.md](debugging-notes.md) has one relevant entry (the Docxsity "pie chart" content-rendering finding, filed there as external/informational, not a defect).

**Status as committed** (`654f040`, "Question group added in docxsity"): implemented and committed. Files touched: `lib/parser.js`, `sites/modality/stateMachine.js`, `sites/docxsity/config/markingSchemes.js`, `sites/docxsity/selectors.js`, `sites/docxsity/stateMachine.js`, `docs/decisions.md`, plus the two real sample files under `samples/`. See [§8 Files changed](#files-changed-by-phase) below for which phase touched what.

---

## 1. What NDA Mathematics support is

A new, fourth exam type — `NDA_MATHEMATICS` — recognized by `lib/parser.js`'s `detectExamType()` and routed to its own dedicated parser function, `parseNda()`. It sits alongside `JEE`, `UPSC_PAPER_I`, and `UPSC_PAPER_II`, none of which it touches.

**Why a new parser path, not an extension of `parseUpsc()`:** NDA's shared-instruction blocks are structurally different from UPSC's passages (see §2) — the directions-marker wording is reversed, and NDA has no separate "Passage – N" label line at all. The project's own convention (see [[feedback_exam_detection_fail_closed]] in memory, and the comment directly above `detectExamType()` in `lib/parser.js`) is that a new exam always gets its own parser function, never a branch bolted onto an existing one. `parseNda()` is that function; `parse()` (JEE) and `parseUpsc()` are provably unchanged (see §8, parser regression).

### Title detection

```js
const NDA_TITLE_PATTERN = /N\.?\s*D\.?\s*A\.?\s*&\s*N\.?\s*A\.?\s*Examination/i;
```

A title must match this pattern **and** separately contain the word "Mathematics" (checked with `/Mathematics/i` right at the call site in `detectExamType()`) to be recognized as `NDA_MATHEMATICS`.

**Deliberately sitting-agnostic.** Real NDA titles look like `N.D.A. & N.A. Examination (I), 2025 – Mathematics (English)`. The `(I)` / `(II)` denotes which of NDA's two yearly *sittings* produced the paper — it is never matched or captured, the same way `UPSC_PAPER_I` already matches every year's Paper I without a year-specific branch. This is not a UPSC-style Paper I/II format distinction; NDA Mathematics only exists as one paper shape regardless of sitting.

**What is intentionally NOT supported:** a title matching the NDA pattern but *without* "Mathematics" (e.g. a future NDA General Ability Test paper, which is a different subject and format, not yet built) falls through to `examType: null`, `questions: []` — the project's standing fail-closed convention for any unrecognized title (see [[feedback_exam_detection_fail_closed]]). This is intentional, not a gap: extending to GAT would need its own reconnaissance and its own parser function, not a loosened title check on this one.

### English/Hindi

Both languages are handled by the same `parseNda()` — no language branch in the parser at all. The structural markers (`NDA_TITLE_PATTERN`, the directions-marker pattern, UPSC's reused option/answer patterns) are all matched by *shape*, not by hardcoded English or Hindi wording, so both language files flow through identically. Verified: both sample files produce structurally identical results (see §3).

### Sample files

`samples/NDA_NA_2025_I_Mathematics_English.md` and `samples/NDA_NA_2025_I_Mathematics_Hindi.md` — the only two NDA source files this project has ever parsed or tested against. Every claim in this document about "the NDA samples" refers to exactly these two files; nothing here has been verified against a different NDA paper, a different sitting, or a hypothetical future format.

### Marking scheme

Marks `2.5`, Penalty `0.83` (displayed as "−0.83 Penalty" on Docxsity) — coincidentally identical to `UPSC_PAPER_II`'s values, not derived from them. These are **fixed constants**, not parsed from the source markdown (NDA papers never state their own marking scheme in text), maintained in two places independently, per the project's existing intentional-duplication convention (see [decisions.md](decisions.md)):

- `sites/modality/stateMachine.js` → `MARKS_PENALTY_BY_UPSC_PAPER.NDA_MATHEMATICS`
- `sites/docxsity/config/markingSchemes.js` → `MARKING_SCHEMES.NDA_MATHEMATICS`

If NDA's real marking scheme ever changes, both places need updating by hand — nothing in the parser or the source markdown would signal that a change happened.

### Subject / tagging

`subject` is always `null` for NDA, the same as UPSC — no subject-tagging semantic was introduced. `runAddTags()` on both sites already treats a missing subject as a no-op success ("skipped"), so this needed no new handling.

---

## 2. Parser architecture

### Entry points

- `detectExamType(rawMarkdown)` — returns `"NDA_MATHEMATICS"` per §1's title rule, or `null`.
- `parseDocument(rawMarkdown)` — the single entry point the panel uses. Calls `detectExamType()`, then routes: `"NDA_MATHEMATICS"` → `{ examType, questions: parseNda(rawMarkdown) }`. Unchanged for every other exam type.
- `parseNda(rawMarkdown)` — NDA's own top-level parser, structurally parallel to `parseUpsc()` but not sharing its body.

### Why UPSC's passage regex could not simply be reused

UPSC's `DIRECTIONS_MARKER_SOURCE` matches lines like `"...for the 3 (three) items that follow :"` — a bare digit, then a parenthesized spelled-out word. NDA's directions lines are the **structural reverse**: `"Consider the following for the three (03) items that follow :"` — a spelled-out word first, then the digits in parentheses. A single regex trying to cover both shapes would have to disambiguate "which side has the digits," which is exactly the kind of per-exam special-casing the project's parser convention avoids (see the comment directly above `NDA_TITLE_PATTERN` in `lib/parser.js`: "never grow an existing exam's parsing logic to also cover a different exam's format").

There's a second structural difference beyond wording: **UPSC has a separate "Passage – N" label line** that the shared stem text sits under, found independently via `PASSAGE_MARKER_SOURCE` and attributed to questions by nearest-preceding-marker logic (`computePassageAssignments()`). **NDA has no such label line at all** — the shared stem simply begins immediately after the directions line and runs until the first governed question starts. This makes NDA's own assignment logic (`computeNdaAssignments()`) genuinely *simpler* than UPSC's, not a reduced reimplementation of it: every NDA directions block governs exactly one shared stem, never several, so there's no passage-to-block disambiguation to do.

```js
const NDA_DIRECTIONS_MARKER_SOURCE = "^.*\\((\\d+)\\).*:\\s*$";
```

Matched structurally — any colon-terminated line containing a parenthesized number — not by hardcoding either language's exact wording. Verified against both sample files: exactly 27 matches per language, zero false positives elsewhere in either document.

### How NDA determines which questions belong to a shared instruction

`computeNdaAssignments(rawMarkdown, questionBoundaries)`:

1. `findNdaDirectionsMarkers()` finds every directions line and its declared item count.
2. For each marker, the next `itemCount` question boundaries *after* that marker (and before the next marker) are the "governed" questions.
3. The stem text is simply `rawMarkdown.slice(marker.contentStart, firstGovernedQuestion.index)` — everything between the end of the directions line and the start of the first governed question.
4. Produces `{question, passage}` tuples in **exactly the shape UPSC's own downstream functions already expect** — so both `passageTextByQuestionIndex()` (the legacy flatten-into-`questionMarkdown` path) and `questionGroupsByQuestionIndex()` (the `group` metadata builder) are reused **completely unchanged** for NDA. This is the core architectural reuse: NDA only needed to produce the same intermediate shape UPSC already produces, not its own parallel metadata builder.

`truncateBeforeNextNdaDirectionsMarker()` mirrors UPSC's `truncateBeforeNextQuestionMetadata()` (a question's own raw block can trail into the next question's directions-line preamble, which must be cut off before options are split out) — with only NDA's own marker pattern, no passage-marker union needed since NDA has no separate passage marker.

### Reused, unchanged, from UPSC's existing code

- `findQuestionBoundaries()`, `splitIntoBlocks()` — generic question-boundary logic, exam-agnostic already.
- `splitUpscOptions()` — NDA's options are lowercase `(a)`–`(d)`, structurally identical to UPSC's, verified against both NDA files.
- `splitAtUpscAnswerMarker()` / `resolveUpscCorrectAnswer()` — verified zero answer-key lines in either NDA file; these safely no-op to `correctAnswer: null` throughout, exactly as needed (see §1).
- `detectImage()` — verified zero images in either NDA file.
- `questionGroupsByQuestionIndex()` — see above; this is the one piece of most consequence, since it's what makes NDA groups indistinguishable in shape from UPSC Paper II groups downstream.

### The three-field distinction: `questionMarkdown`, `questionOnlyMarkdown`, `group`

```
questionMarkdown      shared instruction/stem + question text, always duplicated in
                       (legacy/rollback field — see below)

questionOnlyMarkdown  only the individual question's own text, stem never included
                       (byte-identical to questionMarkdown for a standalone question)

group                 null, or:
                       { id, instructionMarkdown, questionNumbers,
                         isFirstInGroup, isLastInGroup }
```

**Why `questionMarkdown` still duplicates the stem, even though it's not what the live Question Group runtime pastes:** this is a deliberate one-line rollback path, mirrored from UPSC's identical `fullQuestionMarkdown` rationale. If Question Group support ever needed to be reverted (as it was once before, for Modality — see [[project_upsc_support]]), reverting to "always read `questionMarkdown`" requires no parser change, only a one-line change in each site's `runPasteQuestion()`. This is why the parser keeps producing both fields rather than only the leaner `questionOnlyMarkdown`.

**`group`'s exact shape** — identical to UPSC's, not an NDA-specific representation:

```js
{
  id,                    // stable identity = the directions block's position in the document
  instructionMarkdown,   // the shared stem text
  questionNumbers,       // [31, 32, 33] — the group's original question numbers, in order
  isFirstInGroup,        // true only for the first question number in the array
  isLastInGroup,         // true only for the last
}
```

`null` for the 61 standalone NDA questions. This is the same shape `sites/modality/stateMachine.js`'s `resolveCurrentRoot()`/`ensureQuestionFormReady()` and (now) `sites/docxsity/stateMachine.js`'s equivalents already consume for UPSC Paper II — NDA needed **zero** runtime changes to either site's group-handling code beyond one `isUpscExamType()` extension on Modality (see §4). This is the single biggest architectural payoff of reusing `questionGroupsByQuestionIndex()` unchanged: NDA groups are not a new kind of thing the runtime has to learn about.

---

## 3. Verified structure of both sample files

All of the following was confirmed via a Node harness (`require`s `lib/parser.js` directly, with `window` stubbed) run directly against both real sample files — see §6 for the static/parser vs. live distinction.

- **120 questions per language**, `Q1`–`Q120`, sequential, no gaps or duplicates, in both English and Hindi.
- **27 shared-instruction groups**, **59 grouped questions**, **61 standalone questions** — same split in both languages.
- **Identical English/Hindi group membership** — same question-number sets, same order, confirmed programmatically (not just by group count matching). Group sizes: mostly pairs, three groups of 3 (Q31–33, Q36–38, Q41–43), one group of 4 (**Q101–104**, which embeds a markdown frequency-distribution table inside `group.instructionMarkdown` — table integrity verified intact in both languages via independent `$`-count and substring checks against the raw source).
- **Four options, A–D**, present and complete on every question in both files.
- **No answer key in either sample file** — zero matches for the UPSC-style answer marker in either language. `correctAnswer` is therefore `null` for all 120 questions × 2 languages, in every sample this project has ever parsed. This is expected NDA behavior, not a parsing gap — see §1.
- **No images** in either sample file — `hasImage: false` throughout.
- **`type: "MCQ"` always** — no `NUMERICAL` (Fill Blank) questions appear in either sample.
- LaTeX and the Q101–104 table survive intact — verified via independent `$`-count and raw-substring checks per question, both languages, not just visual spot-checks.

**Scope of this claim:** these are facts about *these two files only*. Nothing here should be read as a general guarantee about NDA papers from other years or sittings.

---

## 4. Runtime integration — Modality and Docxsity

### Modality

Every group-consuming function in `sites/modality/stateMachine.js` (`resolveCurrentRoot`, `ensureQuestionFormReady`, `computeSubQuestionLetter`, the group ternary in `runPasteQuestion`, `runPasteOptions`, `runMarkCorrect`, `runGenerateAi`, `runSave`, `runNextQuestion`, `jumpToQuestion`, `passStep`, every `Selectors.questionGroup` entry, every `domHelpers.js` primitive) is **completely untouched** by the NDA addition — none of it references exam type at all; all of it runs purely off `question.group`. NDA questions flow through identically to UPSC Paper II questions, for free.

**The one required Modality change:** `isUpscExamType()` gates the group-aware SAVE/ADD_TAGS-skip logic inside `determineNextState()`. It previously recognized only `UPSC_PAPER_I`/`UPSC_PAPER_II`; extended in place to also return `true` for `NDA_MATHEMATICS`:

```js
function isUpscExamType(examType) {
  return examType === "UPSC_PAPER_I" || examType === "UPSC_PAPER_II" || examType === "NDA_MATHEMATICS";
}
```

Provably behavior-preserving for every pre-existing input (an OR'd-in disjoint case cannot change the result for inputs that were never that case) — confirmed by a zero-diff regression run. Without this change, NDA questions would still get correct root-resolution/pasting/Jump-redirect behavior (none of that is gated by this predicate), but would incorrectly attempt SAVE and ADD_TAGS after *every* group member instead of only the last, and would show the generic no-answer-key message instead of the UPSC-specific one.

### Docxsity

Docxsity's Question Group **runtime itself** (Phases 3A–3C — resolving a Sub Question card, opening/reusing the group modal, group-aware SAVE, Jump redirect) is documented in full in [docxsity.md](docxsity.md)'s "Question Groups" section — it is general-purpose, keyed purely off `question.group`, and was not written specifically for NDA. NDA is simply the first exam type to actually exercise it with real data (UPSC Paper II has group metadata too, but was never live-tested against Docxsity's group runtime in this project).

**`isUpscExamType()` in `sites/docxsity/stateMachine.js` does *not* include `NDA_MATHEMATICS`** — this was checked directly against the committed file during Phase 4B (line 18-20: `return examType === "UPSC_PAPER_I" || examType === "UPSC_PAPER_II";`). This is a real, confirmed asymmetry with Modality's own predicate of the same name (they are independent copies, not shared code — see [decisions.md](decisions.md)'s "Per-option Mark as Correct" entry for the general principle). The only consequence: `runMarkCorrect()`'s no-answer-key message for an NDA question on Docxsity reads the generic *"This question has no correct answer to select."* instead of UPSC's more specific *"This paper does not contain an answer key for this question..."* text. Behavior is otherwise identical — no answer is invented either way, and Docxsity's own group-skip logic in `determineNextState()` is deliberately **not** gated by exam type at all (see [docxsity.md](docxsity.md)), so this asymmetry has no effect on the group SAVE/skip mechanics themselves. Left unfixed, on explicit instruction not to modify code during the validation phase that found it.

---

## 5. Live validation history

**Read this section's headers carefully — the distinction between them is load-bearing, not decorative.**

### STATIC / PARSER TESTS (fully covers both languages, all 120×2 questions)

A Node harness required `lib/parser.js` directly (no browser) and parsed both real sample files, asserting every structural fact in §3: exam type, count, sequential numbering, group count/split, `isFirstInGroup`/`isLastInGroup` correctness, options completeness, `correctAnswer: null`, `questionOnlyMarkdown` presence/absence, EN/HI group-membership equality, and the Q101–104 table's presence in both languages. Result: zero failures, both languages, full 120-question coverage each.

Separately, `parseDocument()`'s output was diffed byte-for-byte before/after the NDA change across all 11 pre-existing JEE/UPSC samples — zero differences (see §8).

### LIVE DOCXSITY TESTS — English only, representative subset, real parsed data

Performed in Phase 4B, against the real committed code (`sites/docxsity/stateMachine.js`/`selectors.js`/`markingSchemes.js` injected byte-identical into a live page, driving the real `executeStep()`/`passStep()`/`jumpToQuestion()`), on a disposable question bank (`TEMP - Phase 4B - NDA Final Validation - DELETE ME`, deleted afterward). Real, English-only, parser-extracted question data was used throughout — never synthetic/invented text.

Covered, with successful SAVE and manual verification of modal contents at key checkpoints:

- **Q30** — standalone, immediately before a group. Full IDLE→SAVE lifecycle. Verified: standalone "Add Question" modal, no group modal, no group card, correct LaTeX-rendered question text, Marks 2.5 / Penalty 0.83 in the actual form inputs, independent save. No-answer-key path confirmed safe: `runMarkCorrect()` returned `success:false` without inventing an answer, and Docxsity's own form validation independently blocked SAVE until a correct option was manually selected (double-safety, both layers correctly refuse to guess).
- **Q31–33** (3-question group) and **Q36–38** (a second, separate 3-question group) — full lifecycle for all three members each. Verified per member: shared instruction pasted once (first member only, exact text match against the parsed `group.instructionMarkdown`), correct sub-question lettering a/b/c, non-last members transition GENERATE_AI→NEXT_QUESTION (skipping ADD_TAGS/SAVE), last member reaches ADD_TAGS→SAVE and the whole group saves in exactly one "Save Question" click (confirmed via a click-count counter in the test harness).
- **Q34–35** and **Q46–47** — two separate 2-question groups, same lifecycle confirmed at the smaller size.
- **Group→group transition**: confirmed twice (Q33→Q34, Q35→Q36) — sub-question lettering correctly resets to "a" for the new group, no instruction leakage from the previous group's text into the new one.
- **Group→standalone transition**: Q47 (last of a group) → Q48 (standalone) — standalone modal opened correctly, no group modal, no leaked shared instruction, independent save.
- **Q99–100** (2-question group) — full lifecycle, saved.
- **Q101–104** (the 4-question group with the embedded frequency-distribution table) — the table was confirmed to render **intact** inside the group instruction field (all 4 rows + header, exact values matching the source). Q101, Q102, and Q103 progressed correctly through sub-questions a/b/c, each reaching NEXT_QUESTION without SAVE as expected. Q104 (the last member) correctly reached ADD_TAGS→SAVE — the group-position logic worked exactly as designed. The SAVE attempt itself then failed, but for a reason unrelated to the NDA parser or the Question Group workflow — see §7.

**Not run in Phase 4B, deliberately, after the Q104 finding:** Jump/Pass Step against this specific NDA data (see the SYNTHETIC note below for why this wasn't a gap), full-group persistence-after-reload inspection for every tested group, and the remaining group→standalone/standalone→group repeats beyond what's listed above. Testing was stopped per the project's Critical Failure Rule once a reproducible SAVE failure was found, and — per explicit direction — not resumed once the failure was confirmed out of scope; the NDA Question Group *workflow* was already considered proven by that point.

### LIVE DOCXSITY TESTS — Hindi

**Did not happen.** No Hindi question was ever pasted into Docxsity's live UI in this project. Hindi coverage is parser-only (§3's static tests, full 120-question coverage) plus the general fact that Docxsity's group runtime code has no language-awareness anywhere in it (it operates purely on whatever markdown string it's given). This is an inference from the code being language-agnostic, not a live-tested fact — do not read anything in this document as claiming otherwise.

### SYNTHETIC STATE-MACHINE TESTS (Jump, Pass Step, group mechanics — pre-NDA)

Docxsity's Jump redirect logic (jumping into a non-first group member redirects to the group's first question), Pass Step's inheritance of the same `determineNextState()` transition logic, and the core group-open/reuse/save mechanics were originally built and verified in Phases 3A–3C using synthetic (hand-constructed, not parser-extracted) test data, before NDA existed as an exam type — see [docxsity.md](docxsity.md) for that history. Phase 4B's real-NDA-data group→group and group→standalone transitions (above) independently re-confirmed the same underlying mechanics hold for real parser output, without needing to re-run Jump/Pass Step from scratch against NDA specifically, since both controls key purely off `question.group` — never off exam type or data origin.

---

## 6. Regression / safety results

- **JEE parser output byte-identical** before/after, across `jee-main-pyq.md`.
- **UPSC parser output byte-identical** before/after, across all UPSC 2021/2023/2024/2025 × Paper I/II × English/Hindi samples present in the repo.
- **Modality's pre-existing behavior unchanged** by the Docxsity Question Group implementation — Docxsity and Modality share no runtime automation code (see [architecture.md](architecture.md)); the one Modality file actually touched for NDA (`isUpscExamType()`'s extension) is provably behavior-preserving, see §4.
- **Docxsity's pre-existing standalone pipeline remained functional** throughout — every Phase 4B group test also exercised the standalone path (Q30, Q48) with no regression.
- **Both real NDA question banks** (`2025 – Mathematics – UPSC NDA & NA (I)` and `(II)`) were never written to at any point in this project — confirmed at **0 Questions** before and after Phase 4B.
- **The disposable Phase 4B bank was deleted** after testing, confirmed gone via a page reload.
- **`node --check` passed** on every touched file as of Phase 4B's completion.
- **No unrelated files were modified** at any point during parser development or live validation.

### Files changed by phase

Not every file changed in every phase — this is the actual, final list (from `git show --stat 654f040`), not a claim that all of it changed together from the start:

| File | Touched for |
|---|---|
| `lib/parser.js` | NDA parser path (`parseNda` and its helpers) — new code, `parse()`/`parseUpsc()` untouched |
| `sites/modality/stateMachine.js` | One-line `isUpscExamType()` extension (§4) |
| `sites/docxsity/config/markingSchemes.js` | One `NDA_MATHEMATICS` entry added |
| `sites/docxsity/selectors.js` | New `questionGroup` selector section (Phase 3A — general Docxsity Question Group support, not NDA-specific) |
| `sites/docxsity/stateMachine.js` | Question Group runtime (Phases 3A–3C — general, not NDA-specific) |
| `docs/decisions.md` | Marking-scheme entry updated; superseded further by this documentation pass (Phase 5) |
| `samples/NDA_NA_2025_I_Mathematics_English.md`, `..._Hindi.md` | New sample files, source of truth for every claim in this document |

All of the above is committed as of `654f040` ("Question group added in docxsity"). Nothing was changed in `lib/session.js`, `content/*`, or `sites/docxsity/domHelpers.js` for this feature.

---

## 7. The Q104 "pie chart" finding — out of scope, documented for the record

Q104's real, parser-extracted Option D text is the literal string `"pie chart"`. When Docxsity's own "Paste Raw Markdown" → "Render & Insert" pipeline processed this text, it auto-detected the leading word **"pie"** as the start of a Mermaid.js `pie` diagram declaration (even with no code fence present), failed to parse the rest of the line as valid Mermaid syntax, and **silently substituted** the string `"Error rendering flow chart"` in place of the actual option text — with no error surfaced at paste time. The corruption only became visible later, at SAVE, via Docxsity's own required-field validation (`"Option text is required."`), which correctly refused to save the corrupted/empty option.

Console evidence captured at the time:
```
Parsing failed: Lexer error on line 1, column 5: unexpected character: ->c<- at offset: 4, skipped 5 characters.
```
(offset 4 = immediately after `"pie "`; the unexpected character is the `c` from `"chart"`.)

**Reproduced three times independently** — the original paste, plus two manual re-pastes into two *different* option cards in the same modal, always with the identical result for text starting with "pie." A control paste of `"bar chart TEST"` into the same modal succeeded normally, ruling out a general "chart"-keyword trigger, a stale-textarea bug, or a session-wide pipeline glitch — the trigger is specifically text beginning with the word "pie."

**This is explicitly documented as an out-of-scope, external, Docxsity-side content-rendering behavior — not a defect in this project's code, and not a Question Group workflow failure:**

- Q101, Q102, and Q103 all progressed correctly through their sub-questions.
- Q104 correctly reached the last-member SAVE state — the group-position logic (`isLastInGroup`) worked exactly as designed.
- The failure happened *inside Docxsity's own markdown renderer*, on content this project's parser correctly and faithfully extracted from the real source document. `runPasteOptions()`'s own success signal (a completed click-and-dialog-close cycle) had no way to detect this class of silent, later-surfacing corruption at paste time.
- No scan of the remaining 120×2 questions for other Mermaid-keyword collisions (`graph`, `flowchart`, `sequenceDiagram`, `gantt`, `classDiagram`, `stateDiagram`, `erDiagram`, `journey`, etc.) was performed — this was explicitly not requested and deliberately not done.
- No workaround, sanitization, content change, or renderer-handling change was made or attempted, on explicit instruction.

If this resurfaces on a real upload, it would need to be solved (if at all) at Docxsity's own content-pipeline / paste-time layer — not by altering NDA's parsed question content, which is a faithful transcription of the source paper.

---

## 8. Design decisions specific to NDA

(General Docxsity Question Group decisions live in [decisions.md](decisions.md) — this list is only the NDA-specific ones.)

- **NDA gets its own parser path (`parseNda`), never a branch inside `parseUpsc`.** Because the directions-marker shape is structurally reversed and NDA has no passage-label line — see §2 — but also because this is the project's standing convention for any new exam, independent of how similar the two formats end up looking.
- **NDA groups use the existing Question Group schema (`{id, instructionMarkdown, questionNumbers, isFirstInGroup, isLastInGroup}`) verbatim**, produced by reusing UPSC's `questionGroupsByQuestionIndex()` unchanged. No NDA-specific group representation was invented. This is what let both sites' existing group-consuming runtime code handle NDA with (on Docxsity) zero changes and (on Modality) one one-line predicate extension.
- **`questionOnlyMarkdown` exists specifically so a group member's shared instruction isn't pasted twice** — once into the group's own Instruction/Title field, and again inside the sub-question's own Question Text field. `questionMarkdown` deliberately keeps the stem folded in anyway, as a one-line rollback path (see §2).
- **The Modality `isUpscExamType()` extension is additive and provably safe** — an OR'd-in disjoint case, verified via zero-diff regression.
- **Docxsity's `isUpscExamType()` was deliberately left unextended** when the asymmetry was found during Phase 4B, since fixing it would be a code change outside that phase's validation-only scope — recorded here rather than silently fixed.

---

## 9. Known limitations

- **The Docxsity "pie chart" Mermaid-rendering collision** (§7) — real, reproducible, external, unfixed, unscanned-for elsewhere.
- **Hindi was never live-tested against Docxsity** — parser-verified only (§5). If Hindi live upload is needed, it should be tested explicitly rather than assumed to work from the English result.
- **No NDA answer key exists in either sample file** — every `correctAnswer` is `null`. The operator must select the correct option manually on the target site for every NDA question (Modality shows an NDA-aware message directing this via Pass Step; Docxsity shows a generic version of the same message — see §4). This is a property of the source papers, not a parsing limitation.
- **Difficulty is not automated** on either site, for any exam type, NDA included — it's a real form field, deliberately never touched by any state handler.
- **Docxsity's `isUpscExamType()` does not recognize `NDA_MATHEMATICS`** (§4) — message-wording-only consequence, not a functional gap; left unfixed on explicit instruction.
- **Stacked-modal risk if a group's PREPARE_FORM is invoked while its own modal is already open** — an inherited limitation of the Question Group runtime in general, not specific to NDA; documented in full in [docxsity.md](docxsity.md).

None of the above are speculative — each is either a directly observed, reproduced finding, or an explicit statement of what was never tested.

---

## 10. Future work

Kept short, deliberately — only what's genuinely supported by what was learned building this:

- If Hindi live-upload confidence is needed, run a representative Hindi Phase-4B-style pass against Docxsity (standalone + at least one group), the same way English was validated.
- If NDA's real answer key ever becomes available for a future sitting, `resolveUpscCorrectAnswer()`'s reuse means it would likely need no NDA-specific change — worth a quick re-verification against that new file's marker format when it happens, rather than assuming.
- If the Docxsity content-rendering collision (§7) becomes a real blocker for an actual upload, that is Docxsity content-pipeline work, scoped and reconnaissance-first, same as everything else in this project — not a quick patch bolted onto the parser or the state machine.
