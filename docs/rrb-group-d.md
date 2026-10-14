# RRB Group D CBT Support

This document covers the `RRB_GROUP_D` exam type end to end: why it needed its own parser path, exactly how that path works, what was verified and how, and what remains unverified or out of scope. It is the source of truth for this feature — prefer this over any session memory when the two disagree.

Related documents: [docxsity.md](docxsity.md) covers the Docxsity state flow this feature drives unchanged, including `ADD_TAGS` (§ "ADD_TAGS"), which is what writes the section names as tags. [decisions.md](decisions.md) covers the "why" behind cross-cutting decisions, including the marking-scheme config module. [nda-gat.md](nda-gat.md) and [nda-mathematics.md](nda-mathematics.md) are the structural precedents for this document; unlike those exams, RRB Group D has no Question Groups, so none of their group material applies here.

**Status:** implemented and validated statically (parser-level, Node harness) against all six sample files. **It has not been live-tested against Docxsity at all** — see §5 and §9 for exactly what that leaves open. At the time of writing the change is in the working tree and has not been committed. Files touched: `lib/parser.js`, `sites/docxsity/config/markingSchemes.js`, plus the six sample files under `samples/RRB Group D/` (see §6). Nothing in `sites/modality/*`, `lib/session.js`, `lib/settings.js`, `content/*`, or any other file under `sites/docxsity/` was touched.

---

## 1. What RRB Group D support is

A new exam type — `RRB_GROUP_D` — recognized by `lib/parser.js`'s `detectExamType()` and routed to its own dedicated parser function, `parseRrb()`. It sits alongside `JEE`, `UPSC_PAPER_I`/`UPSC_PAPER_II`, `NDA_MATHEMATICS`, `NDA_GAT`, `CAT`, `GPSC`, `GUJCET` and the three `CDS_*` types, none of which it touches.

**Supported exam:** RRB Group D CBT, **CEN 09/2025** — the only paper this project has ever parsed or tested against. Every claim in this document about "the RRB samples" refers to exactly the six files in §3; nothing here has been verified against a different CEN, year, or shift.

**Why a new parser path, not an extension of an existing one:** the project's standing convention (a new exam always gets its own parser function, never a branch bolted onto an existing one — see the comment above `detectExamType()` and [nda-gat.md](nda-gat.md) §1) applies here as it did for every earlier exam. It is also required on the merits: RRB's `A.`–`D.` option markers and bare-letter `**Ans.** C` answers match no existing exam's grammar exactly (see §2).

### Title detection

```js
const RRB_GROUP_D_TITLE_PATTERN = /^RRB\s+Group\s*D\b/i;
```

Tested against `title` (the first `# …` heading line, already stripped of its `#`), like every other title pattern in `detectExamType()`. The six sample titles read `RRB Group D — CEN 09/2025 — Shift N (SN) — English` / `— Hindi`. CEN number, year, shift and language are never matched or captured — the same sitting/language-agnostic convention the other title patterns follow. The pattern is anchored on `RRB Group D` as the title's first words rather than a bare `/RRB/` test, so a different RRB exam is never routed here: an RRB NTPC paper has its own exam type, `RRB_NTPC` (see [rrb-ntpc.md](rrb-ntpc.md)), and any other RRB title falls through to `null` (fail-closed). This branch sits after CDS in `detectExamType()` (the `RRB_NTPC` branch follows it); it was checked against all 65 pre-existing sample titles and takes none of them (§5).

### English/Hindi

Both languages are handled by the same `parseRrb()` with no language branch. The title prefix (`RRB Group D`), the `## Section : …` headings, the `A.`–`D.` option labels and `**Ans.**` lines are all written in Latin script in the Hindi files too — **including the four section names, which are English in the Hindi files**. As a result the English and Hindi papers produce the same four tag values.

The Hindi and English files for the same shift are **not** translations of each other in the same question order (for example S1 English Q1 is about parenchyma tissue and S1 Hindi Q1 is about Newton's second law). Do not assume question-number correspondence between the two languages.

### Marking scheme

Marks `1`, Penalty `0.33` (strings, like every other entry) — a fixed constant, not parsed from the source markdown (the papers never state their scheme in text). Configured in exactly one place:

- `sites/docxsity/config/markingSchemes.js` → `MARKING_SCHEMES.RRB_GROUP_D = { marks: "1", penalty: "0.33" }`

`getMarkingScheme("RRB_GROUP_D", "MCQ")` returns that pair. It is a flat entry (not question-type keyed like `CAT`), so the second argument is ignored. The values are identical to `GPSC`'s, but kept as a separate entry, consistent with how the CDS papers are kept separate despite sharing values. Docxsity's Settings Marks/Penalty overrides apply on top of this default exactly as for every other exam type.

**There is no Modality counterpart.** This feature is Docxsity-only. See §4.

### Subject / tagging

`question.subject` is set to the text of the nearest preceding `## Section : <Name>` heading, **preserved exactly as written** (no case-folding, trimming of internal text, or canonical mapping). See §2 for the mechanism and §3 for the four names.

---

## 2. Parser architecture

### Entry points

- `detectExamType(rawMarkdown)` — returns `"RRB_GROUP_D"` per §1's title rule, or falls through.
- `parseDocument(rawMarkdown)` — the single entry point the panel uses. Calls `detectExamType()`, then routes `"RRB_GROUP_D"` → `{ examType, questions: parseRrb(rawMarkdown) }`. Unchanged for every other exam type.
- `parseRrb(rawMarkdown)` — RRB's own top-level parser (also exported on `window.ExamUploadAssistantParser`). It finds the section markers once, then maps every question block through `parseRrbBlock()`.

### Section headings → subject tags

```js
const RRB_SECTION_MARKER_SOURCE = "^##[ \\t]*Section[ \\t]*:[ \\t]*(.+?)[ \\t]*$";
```

Each match becomes a marker `{ index, subject: <captured name> }`. Each question's subject is then resolved by the existing **`findSubjectForIndex(markers, index)`** — the same nearest-preceding-marker lookup JEE and GUJCET use for their subject tags, which is generic over any marker carrying a `.subject`. This is the deliberate reuse: RRB did not introduce a new tagging system, only a new marker regex feeding the existing lookup. A section stays active until the next heading or end of file, and assignment is by explicit heading position — **never by fixed question-number ranges**.

Details of the pattern, each deliberate:

- Exactly two `#`, the literal word `Section` (case-sensitive), a colon, then the name. Anything not shaped like this is not a section heading.
- **Four question bodies in the corpus contain a stray single-`#` line** (for example `# : HJF :: RTP : %`, a letter-analogy placeholder — see §3). Those never match, because the pattern requires `##` **and** the word `Section`.
- Horizontal whitespace only (`[ \t]`), so a malformed heading can never swallow the following line.
- The parser does **not** validate the section names or the section sizes. Any `## Section : X` heading defines a tag `X`. The 25/25/30/20 split in §3 is an observation about these six files, not an enforced rule (see `development-rules.md`: the parser must not know exam-level structure).
- A question appearing before the first heading would get `subject: null`, and `ADD_TAGS` would skip it as it does for any untagged question. This does not occur in the samples.

### Options

```js
const RRB_OPTION_MARKER_SOURCE = "^([A-D])\\.[ \\t]+";
```

Uppercase `A`–`D`, a dot, then whitespace, **anchored to the start of a line** (`m` flag). `splitRrbOptions()` has the same shape as `splitUpscOptions()`: the text before the first marker is the question stem, and each option runs to the next marker or the end of the pre-answer text. Keys are the letters themselves.

Why not an existing option regex:

- CAT's `CAT_OPTION_MARKER_SOURCE` also accepts bare digits. S2 English Q19 and S2 Hindi Q6 carry a digit-numbered list **inside the stem** (`1. Condensation / 2. Evaporation / 3. Precipitation / 4. Collection in water bodies`). When `parseCat` was run directly on those files as a diagnostic (not normal routing), it cut those lists out of the stem. `parseRrb` keeps them (§5).
- Roman-numeral statement lists (`I.`–`IV.`, S2 English Q11 and S2 Hindi Q23) do not match either, since only `A`–`D` are accepted.
- Requiring whitespace after the dot keeps a line like `B.Sc …` from matching.

### Answers

The answer line is `**Ans.** C`. RRB reuses **`splitAtUpscAnswerMarker()` unchanged** to split it off (its pattern, `^\*{0,2}Ans\.\*{0,2}\s*(.*)$`, accepts the bold form and yields the bare payload `C`). Resolution is RRB's own:

```js
const RRB_ANSWER_LETTER_PATTERN = /^[A-D]$/;
```

`resolveRrbCorrectAnswer()` returns the letter if the payload is exactly one of `A`–`D`, otherwise `null`. UPSC's `resolveUpscCorrectAnswer()` is **not** used: it requires a parenthesized letter (`(c)`) and would return `null` for every RRB answer. It was left untouched. A missing, lowercase, parenthesized or otherwise malformed answer resolves to `null` rather than a guess (see §7 for the runtime consequence).

### Section heading cut-off (fail-safe)

`truncateBeforeNextRrbSection()` cuts a block's content at the next section heading before options and answer are split. In a well-formed paper the next heading sits *after* the `**Ans.**` line, so it is already outside the part the parser keeps. The cut exists for one case: the last question of a section with a missing answer line, where, without it, the next heading would be absorbed into that question's last option. This was exercised with a synthetic in-memory case (§5), not a real sample — all 600 real questions have answer lines.

### Reused, unchanged

- `findQuestionBoundaries()` / `splitIntoBlocks()` — `**N.**` question markers, exam-agnostic.
- `splitAtUpscAnswerMarker()` — see above.
- `findSubjectForIndex()` — see above.
- `detectImage()` — zero images in all six samples (§3).

### Output shape

Every question is:

```
questionNumber        from the source (1..100 in all six samples)
subject               nearest preceding "## Section : <Name>" text, verbatim
questionMarkdown      stem only, original markdown preserved (including any
                       tables, lists, "$…$" math, and stray "#" lines)
questionOnlyMarkdown  byte-identical to questionMarkdown (kept for shape parity
                       with the group-capable exams)
type                  "MCQ" always
options               { A, B, C, D }
correctAnswer         "A" | "B" | "C" | "D" | null
hasImage / imageMarkdown   false / null in all six samples
group                 null always
```

**No Question Groups.** None of the six samples contains a Directions line, passage, common-data block, or "questions N to M" range. Self-contained setups inside one question (for example S3 English Q59, "This question is based on the following words." followed by a word list) are part of that single question's stem. Like GUJCET, `parseRrb()` has no group-assignment step at all. **No `NUMERICAL` type** appears either; every question is `MCQ`, so no Fill Blank handling is involved.

As elsewhere in the project, nothing is normalized: the parser records and splits, and does not rewrite or clean up Markdown.

---

## 3. Verified structure of the six sample files

All of the following was confirmed by direct inspection of the files and by a Node harness (`lib/parser.js` and `markingSchemes.js` loaded with `window` stubbed) run through the real `parseDocument()` path, compared question-by-question against an independent line-based reference extractor that shares no code with the parser.

| File | Title (line 1) | Language | Questions |
|---|---|---|---|
| `English md/RRB_GroupD_S1_English.md` | `RRB Group D — CEN 09/2025 — Shift 1 (S1) — English` | English | 100 |
| `English md/RRB_GroupD_S2_English.md` | `… Shift 2 (S2) — English` | English | 100 |
| `English md/RRB_GroupD_S3_English.md` | `… Shift 3 (S3) — English` | English | 100 |
| `Hindi MD/RRB_GroupD_S1_Hindi.md` | `… Shift 1 (S1) — Hindi` | Hindi | 100 |
| `Hindi MD/RRB_GroupD_S2_Hindi.md` | `… Shift 2 (S2) — Hindi` | Hindi | 100 |
| `Hindi MD/RRB_GroupD_S3_Hindi.md` | `… Shift 3 (S3) — Hindi` | Hindi | 100 |

(All under `samples/RRB Group D/`. The files carry the exam as "CEN 09/2025" and shifts as "Shift 1–3 (S1–S3)"; they carry no calendar date, and none is claimed here.)

- **Numbering:** every file has 100 questions, numbered 1–100 in order with no gaps or duplicates, continuing across sections (no reset).
- **The four sections**, in this order, written as `## Section : <Name>` in all six files:

  | # | Section name, exactly as written (this is the tag) | Questions | Range |
  |---|---|---|---|
  | 1 | `General Science` | 25 | 1–25 |
  | 2 | `Mathematics` | 25 | 26–50 |
  | 3 | `General Intelligence and Reasoning` | 30 | 51–80 |
  | 4 | `General Awareness and Current Affairs` | 20 | 81–100 |

  The heading syntax and names are identical across all six files and both languages. The first heading is on line 3, directly after the title; no question precedes it.
- **Options:** every question has exactly four, `A.`–`D.`, one per line, none empty, none duplicated within a question.
- **Answers:** every question has an inline `**Ans.** X` line with X in `A`–`D`. No separate answer key, and no missing, cancelled, dropped or malformed answers.
- **Images:** none (`hasImage: false` for all 600). No `![](…)` or `<img>`, and no figure/diagram placeholders. Charts that the stem calls a "pie chart" or "bar graph" (for example S1 English Q46, S2 English Q28, S3 English Q49) are transcribed as **Markdown tables inside the stem**, with a blank line before each table.
- **Tables:** 2–3 table questions per file; tables are never options.
- **Math:** LaTeX appears as `$…$`.
- **Source irregularities (preserved verbatim, not cleaned up):**
  - **Four stray single-`#` lines** in letter-analogy stems — S2 English L795 and S2 Hindi L498 (`# : HJF :: RTP : %`), S3 English L811 and S3 Hindi L736 (`# : WYA :: VXZ : %`). In Markdown, a line starting `# ` is an H1 heading.
  - **Four questions with a literal `$` symbol** in a symbol-series stem (an odd number of `$` on the line): S1 English Q75, S1 Hindi Q78, S2 English Q51, S2 Hindi Q51.
  - **A digit-numbered list in a stem:** S2 English Q19 and S2 Hindi Q6.
  - **A roman-numeral list in a stem:** S2 English Q11 and S2 Hindi Q23.
- **File hygiene:** LF line endings, no BOM, no trailing whitespace, tabs, NBSP, zero-width or control characters. A scan of line starts for the Docxsity Mermaid-keyword collision documented in [debugging-notes.md](debugging-notes.md) (text beginning `pie`, `graph`, `flowchart`, etc.) found none in these six files.

**Scope of this claim:** facts about these six files only.

---

## 4. Runtime integration — Docxsity only

**No RRB-specific runtime code was written anywhere, and none was needed.** The flow is:

```
parseRrb()  →  standard Question Object  →  existing Docxsity MCQ flow
```

- `PREPARE_FORM` looks up `MarkingSchemes.getMarkingScheme("RRB_GROUP_D", "MCQ")` and fills Marks `1` / Penalty `0.33` (or the Settings override), using the existing MCQ Question Type selection.
- `PASTE_QUESTION` / `PASTE_OPTIONS` / `MARK_CORRECT` / `GENERATE_AI` run as for any standalone MCQ. `group` is `null`, so no Question Group logic is involved.
- `ADD_TAGS` writes `question.subject` into the Tags field and waits for a tag pill with that exact text — the unchanged state documented in [docxsity.md](docxsity.md). The four section names reach it as the subject. It is the same mechanism JEE and GUJCET use for their subjects.
- Settings (Marks/Penalty overrides, feature toggles) and Slideshow are exam-agnostic and unaffected.

`sites/docxsity/stateMachine.js` contains no per-exam branching beyond the marking-scheme lookup and the UPSC-only wording of one message (`isUpscExamType()`, which does not include `RRB_GROUP_D`, as for the NDA, CAT, GPSC, GUJCET and CDS types). The only consequence is the generic wording of the no-answer-key message in `MARK_CORRECT` (see §7).

**No Modality integration exists, and RRB Group D is not supported on Modality.** `sites/modality/*` was not touched. Because `lib/parser.js` is shared, a file with an RRB title would still be detected as `RRB_GROUP_D` if loaded there. Modality has no marking-scheme entry for it and, as for every non-UPSC exam type it has no entry for, falls back to its default (`4` / `1`, `sites/modality/stateMachine.js`). That is not RRB's scheme, so RRB should not be uploaded through Modality. This is the same pre-existing condition that applies to the other Docxsity-only exam types.

---

## 5. Validation

**Read this section's headers carefully — the distinction between them is load-bearing**, the same convention [nda-mathematics.md](nda-mathematics.md) §5 and [nda-gat.md](nda-gat.md) §5 established.

### STATIC / PARSER VALIDATION (all six files, all 600 questions)

A Node harness required `lib/parser.js` and `sites/docxsity/config/markingSchemes.js` directly (no browser) and ran the real `parseDocument()` against each file, comparing every question with an independent reference extractor. **Result: all checks passed.** Per file:

- `detectExamType()` and `parseDocument()` both report `RRB_GROUP_D`.
- Exactly 100 questions, `questionNumber` 1..100 in order.
- All four options present and non-empty, each equal to the reference; none contains an answer line or section-heading text.
- `correctAnswer` resolved to `A`–`D` for all 100 and equal to the reference.
- `subject` equal to the reference for every question, with exactly four distinct values (the §3 names), 25/25/30/20 per section.
- `type: "MCQ"`, `group: null`, `hasImage: false`, and `questionOnlyMarkdown === questionMarkdown` for every question.
- `questionMarkdown` equal to the reference stem for all 600 questions, which covers the following explicitly:
  - S2 English Q19 and S2 Hindi Q6 keep their complete `1.`–`4.` lists (and S2 English Q19's four options are intact).
  - Every table line in every table question is present verbatim in the stem.
  - The four stray `#` lines and the literal-`$` lines are preserved.
- `getMarkingScheme("RRB_GROUP_D", "MCQ")` returns `{ marks: "1", penalty: "0.33" }`, and an unknown exam type still returns `null`.

Two synthetic checks, done in memory only (no file modified): removing the `**Ans.**` line of a last-in-section question leaves `correctAnswer: null`, keeps the next section heading out of that question's last option, and still tags the following question with its own section; and an `RRB NTPC …` title was confirmed not to be routed to `RRB_GROUP_D` (at that time it detected as `null`; RRB NTPC support has since been added, so such a title now detects as `RRB_NTPC` — see [rrb-ntpc.md](rrb-ntpc.md)).

### REGRESSION

`parseDocument()`'s output was captured for every pre-existing `.md` sample in `samples/` (65 files) before and after the change, comparing detected type, exam type, question count, and a SHA-256 of the full serialized result. **Zero differences across all 65**; no existing title was misdetected. (One of the 65 detects as `null` both before and after.) Both edited files pass `node --check`.

The harness and snapshots were ad hoc scripts run outside the repository; they are **not committed** and the repository has no test runner, so this validation is reproducible only by re-writing the same comparison.

### LIVE DOCXSITY VALIDATION — **not performed**

No RRB question has been run through Docxsity. Everything about how Docxsity displays or accepts RRB content is unverified; see §9.

---

## 6. Files changed

| File | Touched for |
|---|---|
| `lib/parser.js` | `RRB_GROUP_D_TITLE_PATTERN` and its `detectExamType()` branch; the RRB parser block (`parseRrb` and helpers), the `parseDocument()` route, the `parseRrb` export. Purely additive (~159 lines); no existing line modified |
| `sites/docxsity/config/markingSchemes.js` | One `RRB_GROUP_D` entry added |
| `samples/RRB Group D/English md/*.md`, `…/Hindi MD/*.md` | The six source samples every claim in this document rests on (not modified by this work) |
| `docs/rrb-group-d.md` | This document (plus a one-sentence cross-reference in `docs/docxsity.md`) |

Nothing was changed in `lib/session.js`, `lib/settings.js`, `content/*`, `manifest.json`, `sites/docxsity/{stateMachine,selectors,domHelpers}.js`, any file under `sites/modality/*`, or any other exam's parser code.

---

## 7. Answer-key behavior

Unlike the 2025 NDA/GAT samples, **every RRB sample question has an answer**, so `MARK_CORRECT` has a letter to act on for all 600 questions in these files. If a future RRB paper omitted an answer line, or wrote it in a different shape (lowercase, parenthesized, a digit), `correctAnswer` would be `null` for that question and the existing no-answer-key behavior would apply — `MARK_CORRECT` fails with the generic message, the session stays at that state, and the operator marks the option manually and uses Pass Step. See [nda-gat.md](nda-gat.md) §7 for that mechanism; nothing about it is RRB-specific, and no answer is ever guessed.

---

## 8. Design decisions specific to RRB Group D

- **RRB gets its own parser path (`parseRrb`)**, never a branch in an existing parser, per the project's standing convention.
- **Section names are the tags, verbatim.** The tag is whatever the `## Section : …` heading says; there is no canonical-name map (unlike JEE's `SUBJECT_CANONICAL_BY_UPPER`) and no hardcoded list of the four names. Assignment is by explicit heading boundary, never by question-number range, so a paper with different section sizes would tag correctly with no code change.
- **Reuse the existing subject lookup, not a new tagging system.** Only the marker regex is RRB-specific; `findSubjectForIndex()` is the same function JEE/GUJCET use.
- **Option and answer handling are RRB-owned constants**, not borrowed from CAT/UPSC. This follows the per-exam isolation convention (see the CDS section comment in `lib/parser.js`) and, for options, is a correctness requirement (§2: CAT's regex would eat in-stem numbered lists). No other exam's resolver or option regex was modified.
- **No Markdown cleanup.** The stray `#` lines and literal `$` characters are preserved byte-for-byte, consistent with the parser rule of preserving each block's original markdown. If they render badly on Docxsity, the fix belongs in the source Markdown (for example escaping), not in a parser heuristic.
- **`group: null` always, `type: "MCQ"` always**, because the corpus contains neither groups nor numerical questions.

---

## 9. Known limitations / still unverified

- **Nothing has been live-tested on Docxsity** (§5). Parser-level correctness is established; Docxsity behavior is not.
- **Multi-word tag handling is unverified.** Every tag value used so far (`Physics`, `Chemistry`, `Mathematics`, `VARC`, `DILR`, `QA`) is a single word. RRB's are multi-word, up to 37 characters (`General Awareness and Current Affairs`). `runAddTags()` waits for a tag pill whose trimmed text equals the subject exactly (`tagPill(subject)` in `selectors.js`); it has not been checked whether Docxsity trims, re-cases, truncates or limits tag text, any of which would make that wait time out. A live check with the longest name is the recommended first test.
- **Rendering of the stray `#` lines is unverified** — the four `# : …` lines are valid Markdown H1 headings and will probably render as headings in Docxsity's editor (S2 and S3, both languages; §3).
- **Rendering of the literal `$` questions is unverified** — Docxsity may treat bare `$` characters as math delimiters (S1 English Q75, S1 Hindi Q78, S2 English Q51, S2 Hindi Q51).
- **Rendering of the table-based chart questions is unverified** (for example S1 English Q46, S2 English Q28, S3 English Q49). The charts exist only as tables in the stem; no image exists to insert.
- **If any of the rendering issues above matter, the fix is in the source Markdown, not the parser** (§8). The parser does not rewrite content.
- **Option-format assumptions.** `parseRrb()` assumes exactly the `A.`–`D.` uppercase, line-start convention seen in all 600 samples. A stem line that itself begins with `A. ` would be read as the first option. A fifth option (`E.`) would not match and would be absorbed into option D's text — silently, not as an error. Neither occurs in the six samples.
- **Section names and sizes are not validated.** A misspelled or extra `## Section : …` heading simply creates another tag value; a missing heading leaves later questions under the previous section.
- **Only CEN 09/2025 has been tested.** A different CEN, year, or a paper whose headings or answer lines differ in shape has not been seen; nothing here is a guarantee for it.
- **Modality is unsupported** (§4).
- **Difficulty is not automated**, as for every other exam type on Docxsity.

Each item above is either a directly observed fact about the six samples or an explicit statement of what was never tested.

---

## 10. Future work

- Run a representative live Docxsity pass: first one question from the last section to check the long multi-word tag (§9); then S2 English Q78 (stray `#` line), one literal-`$` question, and one table question for rendering; then a normal multi-question run. Hindi should be exercised explicitly, since only parser-level coverage exists for it.
- Decide, based on that pass, whether any source-Markdown fixes (escaping the stray `#` lines or literal `$`) are needed.
- If further RRB papers are added, re-validate against them before assuming §3's structure holds, and add them to this document's sample table.

---

## Current status

**RRB Group D (CEN 09/2025) parser and marking scheme are implemented and statically validated; live Docxsity validation has not been performed.**

- Parser (`parseRrb` and helpers) — complete; all 600 questions across the six sample files match an independent reference.
- Marking scheme (Marks 1 / Penalty 0.33) — configured in `sites/docxsity/config/markingSchemes.js`.
- Section tagging — implemented via the existing `findSubjectForIndex()` lookup; tag handling for the multi-word names is unverified on the live site.
- Regression — zero drift across the 65 pre-existing samples.
- **No Modality support** — Docxsity-only.
- **Not committed.**
