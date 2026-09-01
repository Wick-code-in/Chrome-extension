# NDA & NA General Ability Test (GAT) Support

This document covers the `NDA_GAT` exam type end to end: why it needed its own parser path, exactly how that path works, what was verified and how, and what remains unverified or out of scope. It is the source of truth for this feature — prefer this over any session memory when the two disagree.

Related documents: [docxsity.md](docxsity.md) covers the Docxsity Question Group *runtime* GAT drives (built earlier, for NDA Mathematics, and reused here completely unchanged) and the Docxsity-wide Question Type selector update GAT work incidentally discovered. [decisions.md](decisions.md) covers the "why" behind the cross-cutting decisions this feature touches. [nda-mathematics.md](nda-mathematics.md) is the closest precedent — GAT's parser was built by studying that document's approach, not by copying its code. [debugging-notes.md](debugging-notes.md) has the Question Type investigation entry and the pre-existing "pie chart" finding (NDA Mathematics only, not reproduced for GAT).

**Status as committed** (`756b342`, "dropdown updated"): the GAT parser and the Docxsity-wide Question Type fix landed together. Files touched: `lib/parser.js`, `sites/docxsity/config/markingSchemes.js`, `sites/docxsity/selectors.js`, plus the two real sample files under `samples/`. Nothing in `sites/modality/*`, `lib/session.js`, `content/*`, or `sites/docxsity/domHelpers.js`/`stateMachine.js` was touched for this feature — see §4 and §8.

---

## 1. What GAT support is

A new exam type — `NDA_GAT` — recognized by `lib/parser.js`'s `detectExamType()` and routed to its own dedicated parser function, `parseGat()`. It sits alongside `JEE`, `UPSC_PAPER_I`, `UPSC_PAPER_II`, and `NDA_MATHEMATICS`, none of which it touches.

**Why a new parser path, not an extension of `parseNda()` or `parseUpsc()`:** GAT's Directions lines carry no declared item count at all (see §2) — structurally different from both UPSC's and NDA Mathematics's own directions markers, which both always state one. The project's standing convention (a new exam always gets its own parser function, never a branch bolted onto an existing one) applies here exactly as it did for NDA Mathematics — see [nda-mathematics.md](nda-mathematics.md) §1 for the same reasoning applied to that exam.

### Title detection

```js
const NDA_TITLE_PATTERN = /N\.?\s*D\.?\s*A\.?\s*&\s*N\.?\s*A\.?\s*Examination/i;
```

The same pattern `NDA_MATHEMATICS` already uses, reused unchanged. A title must match this pattern **and** separately contain the phrase "General Ability Test" (checked with `/General Ability Test/i` right at the call site in `detectExamType()`) to be recognized as `NDA_GAT`. This branch is additive, placed after the existing `NDA_MATHEMATICS` check — the two are mutually exclusive by construction (a real NDA Mathematics title never contains "General Ability Test," and a real GAT title never contains "Mathematics"), so branch order between them doesn't matter.

**Deliberately sitting-agnostic**, the same way `NDA_MATHEMATICS` and `UPSC_PAPER_I` already are: the `(I)`/`(II)` sitting marker in a real title (`N.D.A. & N.A. Examination (I), 2025 – General Ability Test English`) is never matched or captured. Nothing in this detection is scoped to 2025 or to Sitting I — a future GAT paper from any year or sitting, with this same title shape, is recognized identically.

### English/Hindi

Both languages are handled by the same `parseGat()` — no language branch in the parser at all, the same discipline `parseNda()` already established. The structural markers involved (`NDA_TITLE_PATTERN`, `GAT_PART_MARKER_SOURCE`, `GAT_DIRECTIONS_MARKER_SOURCE`, UPSC's reused option/answer patterns) are all matched by *shape*, not by hardcoded English or Hindi wording.

**Hindi has no Part A in the 2025 sample, and this is a property of the source paper, not an incomplete parser.** The Hindi sample begins directly with `## भाग – B` — no Part A heading exists anywhere in that document. `parseGat()`'s Part-boundary detection (§2) naturally produces zero Question Groups for a document with no Part A marker, with no special-case code required to handle this — it is the direct, structural consequence of the same boundary logic that produces 10 groups for the English file. If a future Hindi GAT source ever does include a Part A section, the exact same code would parse it identically to English's, with no changes needed.

### Sample files

`samples/NDA-NA-I-2025-GAT-English.md` and `samples/NDA-NA-I-2025-GAT-Hindi.md` — the only two GAT source files this project has ever parsed or tested against, both the 2025, Sitting-I paper. Every claim in this document about "the GAT samples" refers to exactly these two files; nothing here has been verified against a different GAT paper, a different sitting, or a different year.

### Marking scheme

Marks `4`, Penalty `1.33` (displayed as "−1.33 Penalty" on Docxsity) — a fixed constant, not parsed from the source markdown (GAT papers never state their own marking scheme in text). Configured in exactly one place:

- `sites/docxsity/config/markingSchemes.js` → `MARKING_SCHEMES.NDA_GAT`

**Unlike NDA Mathematics, GAT has no Modality counterpart at all.** NDA Mathematics's marking scheme is intentionally duplicated in both `sites/docxsity/config/markingSchemes.js` and Modality's own `MARKS_PENALTY_BY_UPSC_PAPER` (`sites/modality/stateMachine.js`) — see [decisions.md](decisions.md)'s marking-scheme-duplication entry. GAT was scoped Docxsity-only from the start of this feature, so no equivalent Modality entry was ever added; Modality has zero GAT support of any kind (see §4).

### Subject / tagging

`subject` is always `null` for GAT, the same as UPSC and NDA Mathematics — no subject-tagging semantic was introduced. `runAddTags()` already treats a missing subject as a no-op success ("skipped"), so this needed no new handling.

---

## 2. Parser architecture

### Entry points

- `detectExamType(rawMarkdown)` — returns `"NDA_GAT"` per §1's title rule, or `null`.
- `parseDocument(rawMarkdown)` — the single entry point the panel uses. Calls `detectExamType()`, then routes: `"NDA_GAT"` → `{ examType, questions: parseGat(rawMarkdown) }`. Unchanged for every other exam type.
- `parseGat(rawMarkdown)` — GAT's own top-level parser, structurally parallel to `parseNda()`/`parseUpsc()` but not sharing its body.

### Why GAT needs its own Directions-boundary logic

Both UPSC's `DIRECTIONS_MARKER_SOURCE` and NDA Mathematics's `NDA_DIRECTIONS_MARKER_SOURCE` always capture a declared item count (`"...for the 3 (three) items that follow :"` / `"...three (03) items that follow :"`) — that count is what tells each of those parsers exactly how many of the following question boundaries a given directions block governs. **GAT's Directions lines never state a count at all** — verified against the English sample: all 10 instances are a bare `Directions : ...` sentence with no parenthesized number anywhere. A single shared regex trying to cover all three shapes would have to guess a count where GAT supplies none, which is exactly the kind of per-exam special-casing this project's parser convention avoids.

```js
const GAT_DIRECTIONS_MARKER_SOURCE = "^Directions\\s*:\\s*(.*)$";
```

Matched structurally — a line beginning with the literal word "Directions," a colon, then free-form text to end of line — group 1 captures everything after the label. Verified via grep against the English sample: **exactly 10 matches**, zero elsewhere in the document (no incidental "Directions" substring anywhere outside these 10 lines). Verified against the Hindi sample: **zero real matches** — the only substring hit for "निर्देश" is inside the unrelated word "नामनिर्देशित" ("nominated"), not anchored at line start, which is exactly why this pattern is anchored rather than a bare substring search.

**With no declared count, GAT determines a Directions block's governed range purely structurally**, via a second new marker:

```js
const GAT_PART_MARKER_SOURCE = "^#{1,6}\\s*\\S+\\s*\\p{Pd}\\s*([AB])\\s*$";
```

Matches GAT's own Part heading — `## PART – A` / `## PART – B` (English) or `## भाग – B` (Hindi) — by shape (a single whitespace-free label token, a dash, a bare "A" or "B"), the same tolerance `PASSAGE_MARKER_SOURCE` already established for passage labels, not by hardcoding "PART" or "भाग." One regex covers both languages' headings with no branch: the English sample has both an "A" and a "B" marker; the Hindi sample (no Part A at all) has only a "B" marker.

`computeGatAssignments(rawMarkdown, questionBoundaries)`:

1. Finds the document's Part A and Part B markers (if a Part A marker doesn't exist at all — the Hindi case — returns immediately with zero assignments; see §1).
2. Searches for Directions markers **only within the Part A span** (between the Part A marker and the Part B marker) — this is what mechanically guarantees a Part A block can never consume a Part B question, rather than relying only on boundary arithmetic.
3. For each Directions marker, in order: the governed range extends to the next Directions marker, or — for the *last* Directions marker in Part A — to the Part B marker itself, never to `Infinity` the way UPSC's and NDA Mathematics's final blocks do (neither of those needs a hard stop, since nothing meaningful follows their last block; GAT's last Part A block must stop exactly at Part B or it would swallow Q51 onward).
4. All question boundaries in that range are governed — there is no `itemCount` to cap against, since none exists.
5. **The passage-vs-instruction distinction** (see §4): if real content (a passage) sits between the Directions marker and the first governed question, that content becomes the shared instruction and the Directions sentence itself is discarded — exactly UPSC's and NDA Mathematics's existing behavior. If that gap is empty, the Directions marker's own captured text (label already excluded by the regex) becomes the shared instruction instead. This is a purely structural test (empty vs. non-empty gap), not a keyword check.

Produces `{question, passage}` tuples in the exact shape `passageTextByQuestionIndex()` and `questionGroupsByQuestionIndex()` (both already defined, for UPSC) expect, so **both are reused here completely unchanged** — the same reuse NDA Mathematics already established.

`truncateBeforeNextGatBoundary()` mirrors UPSC's `truncateBeforeNextQuestionMetadata()`/NDA's `truncateBeforeNextNdaDirectionsMarker()` (a question's own raw block can trail into the next Directions line's preamble, which must be cut off before options are split out) — but unions two marker shapes instead of one: the Directions marker *and* the Part marker, since Part A's very last governed question (Q50 in the English sample) trails not into another Directions line but into the `## PART – B` heading itself, which must be cut off the same way.

### The table-option fallback

Three questions per language ("Match List I with List II...", English Q62/81/84, Hindi Q12/31/34 — verified via grep, exactly 3 each) encode their four options as a markdown table rather than plain `(a) ...` lines: a header row `| | A | B | C | D |` (literal Latin letters, byte-identical in both languages), then up to 4 data rows (`| (a) | 1 | 4 | 3 | 2 |` etc.). `splitUpscOptions()` cannot parse this shape at all — it requires a line starting with `(a)`, not a table cell.

```js
function splitGatOptions(beforeAnswer) {
  const standard = splitUpscOptions(beforeAnswer);
  if (standard.options) { return standard; }
  const matchList = parseGatMatchListOptions(beforeAnswer);
  return matchList || standard;
}
```

`splitUpscOptions()` itself is **never modified** — `splitGatOptions()` tries it first, unchanged, and only falls back to the new `parseGatMatchListOptions()` when it finds nothing. The table's header row (`GAT_MATCH_LIST_HEADER_SOURCE`) is the detection signature — language-agnostic, since both languages render the A/B/C/D column labels in Latin letters. Each data row is parsed and reconstructed into a readable option string zipped against the header labels, e.g. Q62's row `| (a) | 1 | 4 | 3 | 2 |` becomes `options.A = "A – 1, B – 4, C – 3, D – 2"` — a faithful transcription of the row's own mapping, not an invented value. Everything before the header row (including the question's own separate "List I / List II" content table, which is part of its stem, not its options) is returned unchanged as the question's own text.

### Reused, unchanged, from UPSC's/NDA's existing code

- `findQuestionBoundaries()`, `splitIntoBlocks()` — generic question-boundary logic, exam-agnostic already.
- `splitUpscOptions()` — for the ~147/150 English and ~97/100 Hindi questions using plain `(a)`–`(d)` lines; never modified for GAT (see above).
- `splitAtUpscAnswerMarker()` / `resolveUpscCorrectAnswer()` — see §7 for exactly how these behave for GAT.
- `detectImage()` — verified zero images in either GAT sample file.
- `passageTextByQuestionIndex()`, `questionGroupsByQuestionIndex()` — reused completely unchanged; see above.

### The three-field distinction: `questionMarkdown`, `questionOnlyMarkdown`, `group`

Identical semantics to UPSC's and NDA Mathematics's own fields — no redefinition, no GAT-specific variant:

```
questionMarkdown      shared instruction + question text, always folded together
                       (legacy/rollback field — see below)

questionOnlyMarkdown  only the individual question's own text, shared instruction never included
                       (byte-identical to questionMarkdown for a standalone question)

group                 null, or:
                       { id, instructionMarkdown, questionNumbers,
                         isFirstInGroup, isLastInGroup }
```

**Why `questionMarkdown` still folds the shared instruction in, even for GAT's instruction-only groups (§4):** the same deliberate one-line rollback path NDA Mathematics and UPSC already rely on. If Question Group support ever needed to be reverted, reverting to "always read `questionMarkdown`" requires no parser change, only a one-line change in each site's `runPasteQuestion()`. For a Case B (instruction-only) question this means `questionMarkdown` becomes the Directions sentence followed by the question — exactly the correct flattened presentation if group support were ever rolled back.

`group`'s exact shape is identical to UPSC's and NDA Mathematics's — not a GAT-specific representation, produced by the same unmodified `questionGroupsByQuestionIndex()`.

---

## 3. Verified structure of both sample files (static/parser validation)

All of the following was confirmed via a Node harness (`require`s `lib/parser.js` directly, with `window` stubbed) run directly against both real sample files — **925/925 assertions passed**. See §5 for the static/parser vs. live distinction.

- **English: 150 questions**, `Q1`–`Q150`, sequential, no gaps or duplicates. **Part A = Q1–50, Part B = Q51–150.**
- **Hindi: 100 questions**, locally numbered `Q1`–`Q100` (not `Q51`–`Q150`) — Part B only, confirmed zero Part A markers anywhere in the file.
- **Exactly 10 Question Groups in English Part A**, verified with their exact membership:

  | Group | Question numbers | Kind |
  |---|---|---|
  | 1 | Q1–5 | Passage group |
  | 2 | Q6–8 | Instruction group |
  | 3 | Q9–10 | Instruction group |
  | 4 | Q11–15 | Instruction group |
  | 5 | Q16–20 | Instruction group |
  | 6 | Q21–25 | Instruction group |
  | 7 | Q26–35 | Instruction group (10 members) |
  | 8 | Q36–40 | Instruction group |
  | 9 | Q41–45 | Instruction group |
  | 10 | Q46–50 | Instruction group |

  Correct `isFirstInGroup`/`isLastInGroup` verified on every grouped question; Group 10 (Q46–50) verified to stop exactly at Q50, with Q51 confirmed standalone and never absorbed into it.
- **English Part B (Q51–150) and all of Hindi (Q1–100) are fully standalone** — zero groups, `group: null` throughout, confirmed by assertion.
- **Passage-group semantics verified for Q1–5**: `group.instructionMarkdown` starts with the actual passage text ("An attempt to determine the number of languages in the world is affected by other factors. ...") and contains no "Directions"/wrapper wording; `questionOnlyMarkdown` excludes the passage; `questionMarkdown` folds passage + question together.
- **Instruction-group semantics verified for Q6–8** (and, structurally, for the other 8 instruction groups): `group.instructionMarkdown` for all three members is byte-identical and reads exactly `"The following items have a sentence in direct or indirect speech with four options. One of the options converts the direct or indirect speech into indirect or direct correctly. Select the correct option and mark your response on the Answer Sheet."` — the Directions sentence verbatim, its own "Directions :" label excluded. `questionOnlyMarkdown` for each member excludes that sentence entirely.
- **Four options, A–D**, present and complete on all 150 English and all 100 Hindi questions, including the 6 table-option questions (verified reconstructed values, e.g. English Q62: `{A: "A – 1, B – 4, C – 3, D – 2", B: "A – 2, B – 3, C – 4, D – 1", C: "A – 2, B – 4, C – 3, D – 1", D: "A – 1, B – 3, C – 4, D – 2"}`; Hindi Q12's table carries the identical underlying numeric mapping).
- **No answer key in either 2025 sample file** — zero matches for the standard answer marker in either language. `correctAnswer` is `null` for all 150 English and all 100 Hindi questions in these two files. This is a property of *these two files* (see §7 — do not read this as "GAT has no answer key").
- **No images** in either sample file — `hasImage: false` throughout.
- **`type: "MCQ"` always** — no `NUMERICAL` (Fill Blank) questions appear in either sample.
- **English Part B / Hindi correspondence** verified by relative position (English Q(50+n) ↔ Hindi Q(n)) for all 100 positions, including the three table-option questions per language (English Q62/81/84 ↔ Hindi Q12/31/34).

**Scope of this claim:** these are facts about *these two files only* (2025, Sitting I). Nothing here should be read as a general guarantee about GAT papers from other years or sittings.

---

## 4. Runtime integration — Docxsity only

**No GAT-specific Question Group runtime was written anywhere, and none was needed.** The flow is:

```
parseGat()  →  standard Question Object  →  question.group  →  existing Docxsity Question Group runtime
```

Every group-consuming function in `sites/docxsity/stateMachine.js` — `resolveCurrentRoot`, `ensureQuestionFormReady`, `computeSubQuestionLetter`, `determineNextState()`'s group-skip branch, `runSave()`'s group-modal selection, `jumpToQuestion()`'s redirect, `passStep()`'s inherited transition logic — is **completely untouched** by GAT. None of it references exam type for ordinary group mechanics; all of it runs purely off `question.group`, exactly as documented in [docxsity.md](docxsity.md)'s "Question Groups" section (built for, and first proven by, NDA Mathematics — see [nda-mathematics.md](nda-mathematics.md) §4). GAT is simply the second exam type to exercise that same runtime with real data, including — for the first time — a group larger than 4 members (Group 7, Q26–35, 10 members) and, for the first time, groups whose shared instruction is not a passage at all (§ above).

**No Modality integration exists for GAT at all.** Every other exam type this project supports has at least a marking-scheme entry in Modality's own `MARKS_PENALTY_BY_UPSC_PAPER`; NDA Mathematics additionally required a one-line `isUpscExamType()` extension there. GAT has neither — this feature was scoped Docxsity-only from the start, and `sites/modality/*` was never touched.

**`isUpscExamType()` in `sites/docxsity/stateMachine.js` does not include `NDA_GAT`** (it currently reads `return examType === "UPSC_PAPER_I" || examType === "UPSC_PAPER_II";`, the same as it already didn't include `NDA_MATHEMATICS` — see [nda-mathematics.md](nda-mathematics.md) §4 for that identical, pre-existing asymmetry). The only consequence: `runMarkCorrect()`'s no-answer-key message for a GAT question on Docxsity reads the generic *"This question has no correct answer to select."* instead of a UPSC/NDA-specific one. Behavior is otherwise identical — no answer is invented either way, and Docxsity's own group-skip logic in `determineNextState()` is deliberately **not** gated by exam type at all, so this asymmetry has zero effect on group SAVE/skip mechanics. Left as-is, consistent with how the identical asymmetry was left for NDA Mathematics.

### The Docxsity-wide Question Type update (discovered during, but not specific to, GAT work)

While preparing GAT for live testing, Docxsity's live Question Type `ng-select` was found to have renamed/expanded its option set since the values `sites/docxsity/selectors.js` was originally verified against:

| Old (previously documented) | Current, live-verified |
|---|---|
| MCQ Choice | **Multiple Choice Question** |
| *(none)* | **Multiple Select Question** *(new)*|
| True False | True False |
| Short Answer | Short Answer |
| Long Answer | Long Answer |
| Fill Blank | Fill Blank |

This broke MCQ-type selection for **every** exam type on Docxsity (JEE, UPSC Paper I/II, NDA Mathematics, and GAT alike), not GAT specifically — `runPrepareForm()` was passing the stale `"MCQ Choice"` value to the generic, unmodified `DomHelpers.selectDropdown()`, which could no longer find a matching `.ng-option`. The fix was a single constant update in `sites/docxsity/selectors.js` (`MCQ_OPTION_VALUE = "Multiple Choice Question"`) — no change to `domHelpers.js` (already fully generic ng-select automation, no hardcoded label knowledge) and no change to `stateMachine.js` (already value-agnostic). See [docxsity.md](docxsity.md)'s PREPARE_FORM section and [decisions.md](decisions.md) for the full detail; recorded here only to make clear this fix rides along with GAT's commit but is not GAT-scoped behavior.

---

## 5. Validation

**Read this section's headers carefully — the distinction between them is load-bearing, not decorative**, the same convention [nda-mathematics.md](nda-mathematics.md) §5 established.

### STATIC / PARSER VALIDATION (fully covers both languages, all 150+100 questions)

A Node harness required `lib/parser.js` directly (no browser) and parsed both real sample files, asserting every structural fact in §3: exam type, counts, sequential numbering, the exact 10-group membership table, `isFirstInGroup`/`isLastInGroup` correctness, the passage-vs-instruction `instructionMarkdown` split (Q1–5 vs. Q6–8 verified with exact text), `questionOnlyMarkdown`/`questionMarkdown` correctness, options completeness (including all 6 table-option questions, values verified against the exact source table rows), `type: "MCQ"` throughout, `correctAnswer: null` throughout (both files), and EN/HI Part B correspondence for all 100 positions. **Result: 925/925 checks passed, zero failures.**

Separately, `parseDocument()`'s output was diffed byte-for-byte before/after the GAT change across all 13 pre-existing JEE/UPSC/NDA Mathematics samples in the repository — zero differences.

### LIVE DOCXSITY VALIDATION — manually performed by the project owner

**Claude's own browser-automation tooling could not perform automated live-DOM verification of the GAT workflow.** Across every attempt in this project's session history, `window.ExamUploadAssistantParser`/`Session`/`StateMachine`/`Selectors` were never present in the Chrome tab Claude's browser tools were driving — even after the project owner confirmed the unpacked extension was loaded and working correctly in their own manual Chrome session, and after reloading it in `chrome://extensions`. `chrome://extensions` pages are themselves outside what Claude's browser tools can inspect, so the discrepancy could not be self-diagnosed further than confirming the content-script globals were absent. **This is not a defect in the extension** — the extension worked correctly throughout in the project owner's own browser context; it is a limitation of the automation tooling's browser context in this environment, recorded here so a future session doesn't waste time re-attempting it without first confirming the same content-script globals are actually reachable.

Given that, the actual GAT → Docxsity workflow was **manually tested and confirmed working by the project owner**, directly in their own Docxsity session, using real parsed GAT English data, covering the intended representative cases: a standalone question, the passage Question Group (Q1–5), instruction-only Question Groups (including the 10-member Q26–35 group), group-to-group and group-to-standalone transitions, a table-option question, the Docxsity-wide Question Type fix, the marking scheme (Marks 4 / Penalty 1.33), and the missing-answer-key → `MARK_CORRECT` → Pass Step flow. The project owner confirmed the workflow behaves as intended. Beyond that summary, this document does not record per-question DOM evidence (modal counts, exact field contents, save-click counts, and similar granular detail) for this pass, because Claude did not independently observe it and does not have itemized results to report faithfully — unlike [nda-mathematics.md](nda-mathematics.md) §5's Phase 4B entry, which records that level of detail because Claude performed and directly observed that testing pass itself.

**Hindi was not live-tested against Docxsity** in this pass — coverage is parser-only (§3, full 100-question coverage), the same open item NDA Mathematics also carries (see [nda-mathematics.md](nda-mathematics.md) §5, §9).

---

## 6. Regression / safety results

- **JEE, UPSC (all four papers × both languages), and NDA Mathematics (both languages) parser output byte-identical** before/after the GAT change.
- **Modality's pre-existing behavior is unaffected** — `sites/modality/*` was never touched for GAT (see §4).
- **Docxsity's pre-existing Question Group and standalone runtime is unaffected** — no line in `sites/docxsity/stateMachine.js`, `selectors.js` (beyond the Question Type value, §4), or `domHelpers.js` was changed for group mechanics.
- **`node --check` passed** on every file touched (`lib/parser.js`, `sites/docxsity/config/markingSchemes.js`, `sites/docxsity/selectors.js`) as of the committed state.
- **No unrelated files were modified** during parser development, the Question Type fix, or this documentation pass.

### Files changed

From `git show --stat 756b342` ("dropdown updated"), the commit containing this feature:

| File | Touched for |
|---|---|
| `lib/parser.js` | GAT parser path (`parseGat` and its helpers) — new code; `parse()`/`parseUpsc()`/`parseNda()` untouched |
| `sites/docxsity/config/markingSchemes.js` | One `NDA_GAT` entry added |
| `sites/docxsity/selectors.js` | `MCQ_OPTION_VALUE` updated (Docxsity-wide fix, §4) — no `questionGroup` or other section changed |
| `samples/NDA-NA-I-2025-GAT-English.md`, `..._Hindi.md` | New sample files, source of truth for every claim in this document |

Nothing was changed in `lib/session.js`, `content/*`, `sites/docxsity/domHelpers.js`, `sites/docxsity/stateMachine.js`, or any file under `sites/modality/*`.

---

## 7. Answer-key behavior

**GAT is not "an exam with no answer key."** The 2025 (and, per the project's stated expectations, 2024) papers are the known exception — most GAT papers from the intended supported range (2011–2023) are expected to carry a real answer key.

The parser reflects this correctly: `parseGatBlock()` calls `splitAtUpscAnswerMarker()` / `resolveUpscCorrectAnswer()` **completely unchanged**, the identical standard mechanism `parseUpsc()`/`parseNda()` already use. If a future older-year sample's answer-key marker matches the existing `UPSC_ANSWER_LINE_SOURCE` shape, `correctAnswer` would be extracted normally with no parser change at all. The two 2025 samples on hand simply have zero matching answer-key lines — verified, not assumed — so `correctAnswer` resolves to `null` for all 150 English and all 100 Hindi questions in *these two files specifically*. **No GAT-specific answer format exists, and none was invented.**

**Runtime behavior when `correctAnswer` is `null` is the same mechanism every other keyless paper on this project already uses, nothing new:**

- `MARK_CORRECT` fails with the existing no-answer-key message (generic wording on Docxsity for GAT, since `isUpscExamType()` doesn't include it — see §4) — a plain `{success: false}` result, not a thrown error.
- `executeStep()` only advances `Session`'s state on success, so the session simply remains at `MARK_CORRECT` — **the workflow does not terminate**.
- The operator manually selects the correct option on the live Docxsity page, then uses **Pass Step**, which calls the same `determineNextState()` and advances the session regardless of the earlier failure.
- The workflow then continues normally from `GENERATE_AI` onward.

This is intentional, existing behavior — the same mechanism 2024–2025 UPSC papers and both NDA Mathematics sample files already rely on. Never guess or invent an answer.

**If a real older-year GAT sample is obtained**, its actual marker text should be verified against `UPSC_ANSWER_LINE_SOURCE`'s exact shape before assuming it matches — this document makes no claim about that format, only that the mechanism to extract it, if it matches, already exists and needs no change.

---

## 8. Design decisions specific to GAT

(General cross-cutting decisions — the Question Group model's applicability beyond passages, and the Question Type selector-value lesson — live in [decisions.md](decisions.md); this list is only the GAT-specific ones.)

- **GAT gets its own parser path (`parseGat`), never a branch inside `parseUpsc`/`parseNda`.** Because GAT's Directions marker carries no declared item count at all — structurally different from both UPSC's and NDA Mathematics's own markers — but also because this is the project's standing convention for any new exam, independent of how similar the formats end up looking.
- **Every set of GAT Part A questions governed by one Directions/instruction block is a Question Group — passage-bearing or not.** This resolves what was, during design, an open question between two options (group only the genuine passage block, or group every Directions block): the decision made was that the deciding criterion is "does one common instruction govern multiple consecutive questions," not "is there a passage." All 10 Part A blocks meet that criterion (§2, §3).
- **Passage groups (Q1–5) strip the generic Directions wrapper and use only the actual passage as the shared instruction** — this preserves UPSC's and NDA Mathematics's existing passage-group semantics exactly, applied to the one GAT block that has real passage content.
- **Instruction-only groups (the other 9 Part A blocks) put the Directions/instruction text itself into the shared Question Group instruction field**, with the literal "Directions :" label excluded but the substantive text preserved verbatim, including its original punctuation. This is a new structural rule this feature introduced — the first time this project's Question Group model has been used for a shared instruction that is not source-level passage/stem content.
- **GAT groups use the existing Question Group schema (`{id, instructionMarkdown, questionNumbers, isFirstInGroup, isLastInGroup}`) verbatim**, produced by reusing `questionGroupsByQuestionIndex()` unchanged. No GAT-specific group representation was invented, and — per §4 — no GAT-specific Docxsity runtime branch exists either.
- **`questionOnlyMarkdown` exists specifically so a group member's shared instruction isn't pasted twice** — once into the group's own Instruction/Title field, once into the sub-question's own Question Text. This holds identically whether the shared instruction is a passage or a Directions sentence — the field's purpose doesn't change based on content kind.
- **The table-option fallback (`parseGatMatchListOptions`) is a new, narrowly-scoped GAT helper, not a change to `splitUpscOptions()`.** It is tried only after the generic option-marker split finds nothing, and only 6 real questions (3 per language) in the current samples ever reach it.

---

## 9. Known limitations

- **Hindi was never live-tested against Docxsity** — parser-verified only (§5). If Hindi live-upload confidence is needed, it should be tested explicitly, the same open item NDA Mathematics also carries.
- **Claude's browser-automation tooling could not reach the extension's content scripts in this environment** (§5) — live validation for this feature was performed manually by the project owner, not observed step-by-step by Claude. Not an extension defect.
- **Docxsity's `isUpscExamType()` does not recognize `NDA_GAT`** (§4) — message-wording-only consequence (generic vs. paper-specific no-answer-key text), not a functional gap; left as-is, consistent with the identical, pre-existing NDA Mathematics asymmetry.
- **No older-year (2011–2023) GAT sample has been obtained or tested** — the answer-key marker format for those years is unverified (§7); do not assume it matches `UPSC_ANSWER_LINE_SOURCE` until a real sample confirms it.
- **Difficulty is not automated**, the same as every other exam type on Docxsity — a real form field, deliberately never touched by any state handler.
- **The Docxsity "pie chart" Mermaid-rendering collision** documented in [nda-mathematics.md](nda-mathematics.md) §7 is an NDA Mathematics finding (that paper's Q104 Option D text), not a GAT finding — GAT has not reproduced this or any other content-rendering collision; no scan for one was performed.
- **Stacked-modal risk if a group's `PREPARE_FORM` is invoked while its own modal is already open** — an inherited limitation of the Question Group runtime in general (documented in full in [docxsity.md](docxsity.md)), not specific to GAT.

None of the above are speculative — each is either a directly observed/verified fact, or an explicit statement of what was never tested.

---

## 10. Future work

- If Hindi live-upload confidence is needed, run a representative Hindi pass against Docxsity (standalone + at least one table-option question), the same way NDA Mathematics's own deferred Hindi item is scoped.
- If a real older-year (2011–2023) GAT sample becomes available, verify its actual answer-key marker format before assuming `resolveUpscCorrectAnswer()`'s reuse covers it — likely needs no change, but should be confirmed rather than assumed (§7).
- If Claude's browser-automation tooling is ever able to reach the same Chrome context the extension is loaded in, a fully Claude-observed live validation pass (the same depth as NDA Mathematics's Phase 4B) would be worth doing, to get itemized DOM evidence rather than a summary confirmation.

---

## Current status

**NDA & NA GAT support for Docxsity is implemented and manually validated.**

- Parser (`parseGat` and its helpers) — complete, statically verified (925/925 checks) against both real 2025 sample files.
- Marking scheme (Marks 4 / Penalty 1.33) — complete, configured in `sites/docxsity/config/markingSchemes.js`.
- Question Group integration — complete, requires zero GAT-specific runtime code; rides entirely on the existing, NDA-Mathematics-proven Docxsity Question Group runtime.
- Docxsity-wide Question Type selector — updated (a site-wide fix discovered during this work, not GAT-specific — §4).
- Static/parser regression — passed, zero drift across all pre-existing exam types.
- Live Docxsity validation — manually performed and confirmed by the project owner; not independently observed step-by-step by Claude in this environment (§5).
- **No Modality GAT implementation exists** — this feature is Docxsity-only by design.
- Older-year (2011–2023) answer-key support should be considered **unverified** until an actual source sample from those years is obtained and tested — do not treat it as confirmed working from this document alone.
