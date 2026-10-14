# RRB NTPC CBT Support

This document covers the `RRB_NTPC` exam type end to end: why it has its own parser path, exactly how that path works, what was verified and how, and what remains unverified or out of scope. It is the source of truth for this feature — prefer this over any session memory when the two disagree.

Related documents: [docxsity.md](docxsity.md) covers the Docxsity state flow this feature drives unchanged, including `ADD_TAGS` (§ "ADD_TAGS"), which is what writes the section names as tags. [decisions.md](decisions.md) covers the "why" behind cross-cutting decisions, including the marking-scheme config module. [rrb-group-d.md](rrb-group-d.md) is the closest precedent — NTPC's parser was written independently of it (see §8), not by routing through it. Like Group D, and unlike [nda-gat.md](nda-gat.md) / [nda-mathematics.md](nda-mathematics.md), RRB NTPC has no Question Groups, so none of their group material applies here.

**Status:** implemented and validated statically (parser-level, Node harness) against all six sample files. **It has not been live-tested against Docxsity at all** — see §5 and §9 for exactly what that leaves open. At the time of writing the change is in the working tree and has not been committed. Files touched: `lib/parser.js`, `sites/docxsity/config/markingSchemes.js`, plus the six sample files under `samples/RRB NTPC/` (see §6). Nothing in `sites/modality/*`, `lib/session.js`, `lib/settings.js`, `content/*`, or any other file under `sites/docxsity/` was touched.

---

## 1. What RRB NTPC support is

A new exam type — `RRB_NTPC` — recognized by `lib/parser.js`'s `detectExamType()` and routed to its own dedicated parser function, `parseRrbNtpc()`. It sits alongside `JEE`, `UPSC_PAPER_I`/`UPSC_PAPER_II`, `NDA_MATHEMATICS`, `NDA_GAT`, `CAT`, `GPSC`, `GUJCET`, the three `CDS_*` types and `RRB_GROUP_D`, none of which it touches.

**Supported exam:** RRB NTPC CBT-1, **CEN 07/2025, Under Graduate Level** — the only paper this project has ever parsed or tested against. Every claim in this document about "the NTPC samples" refers to exactly the six files in §3; nothing here has been verified against a Graduate-level paper, a CBT-2 paper, a different CEN, or a different year.

**Why a new parser path, not a route through `parseRrb()`:** the project's standing convention (a new exam always gets its own parser function — see the comment above `detectExamType()` and [nda-gat.md](nda-gat.md) §1) applies. `parseRrbNtpc()` neither calls nor shares a constant with `parseRrb()`, even though the two grammars happen to be the same shape (§7): the exams stay independently changeable, so a future edit for one cannot silently alter the other.

### Title detection

```js
const RRB_NTPC_TITLE_PATTERN = /^RRB\s+NTPC\b/i;
```

Tested against `title` (the first `# …` heading line, already stripped of its `#`), like every other title pattern in `detectExamType()`. The six sample titles read `RRB NTPC — CEN 07/2025 — Under Graduate Level (CBT I) — Shift N — English` / `— Hindi`. CEN number, level, shift and language are never matched or captured. The pattern is anchored on `RRB NTPC` as the title's first words, and `\b` keeps a different word such as `RRB NTPCX` from matching. It is disjoint from `RRB_GROUP_D_TITLE_PATTERN`. The branch is the last one in `detectExamType()`, after RRB Group D.

The shift date does not appear in the title — only in the filenames (five files say `07-05-26`, the Shift 3 Hindi file says `08-05-26`). The parser never reads filenames.

### English/Hindi

Both languages are handled by the same `parseRrbNtpc()` with no language branch. The title prefix, the `## Section : …` headings, the `A.`–`D.` option labels and the `**Ans.**` lines are all Latin-script in the Hindi files too — **including the three section names, which are English in the Hindi files**. As a result the English and Hindi papers produce the same three tag values, and the Hindi papers get English tags (verbatim, by decision — see §8).

The English and Hindi files for the same shift are **not** translations of each other in the same question order (for each shift, 0 of 99–100 positions have identical option text, and answer letters coincide only 17–33% of the time). Do not assume question-number correspondence between the two languages.

### Marking scheme

Marks `1`, Penalty `0.33` (strings, like every other entry) — a fixed constant, not parsed from the source markdown (the papers never state their scheme in text). Configured in exactly one place:

- `sites/docxsity/config/markingSchemes.js` → `MARKING_SCHEMES.RRB_NTPC = { marks: "1", penalty: "0.33" }`

`getMarkingScheme("RRB_NTPC", "MCQ")` returns that pair. It is a flat entry, so the second argument is ignored. The values are identical to `RRB_GROUP_D`'s and `GPSC`'s but kept as a separate entry, consistent with how the CDS papers are kept separate despite sharing values. The value comes from the project owner's stated requirement; the samples themselves do not confirm it. Docxsity's Settings Marks/Penalty overrides apply on top of this default exactly as for every other exam type.

**There is no Modality counterpart.** This feature is Docxsity-only. See §4.

### Subject / tagging

`question.subject` is set to the text of the nearest preceding `## Section : <Name>` heading, **preserved exactly as written** (no case-folding, trimming of internal text, translation or canonical mapping). See §2 for the mechanism and §3 for the three names.

---

## 2. Parser architecture

### Entry points

- `detectExamType(rawMarkdown)` — returns `"RRB_NTPC"` per §1's title rule, or falls through.
- `parseDocument(rawMarkdown)` — the single entry point the panel uses. Calls `detectExamType()`, then routes `"RRB_NTPC"` → `{ examType, questions: parseRrbNtpc(rawMarkdown) }`. Unchanged for every other exam type.
- `parseRrbNtpc(rawMarkdown)` — NTPC's own top-level parser (also exported on `window.ExamUploadAssistantParser`). It finds the section markers once, then maps every question block through `parseRrbNtpcBlock()`.

### Section headings → subject tags

```js
const RRB_NTPC_SECTION_MARKER_SOURCE = "^##[ \\t]*Section[ \\t]*:[ \\t]*(.+?)[ \\t]*$";
```

Each match becomes a marker `{ index, subject: <captured name> }`. Each question's subject is then resolved by the existing **`findSubjectForIndex(markers, index)`** — the same nearest-preceding-marker lookup JEE, GUJCET and RRB Group D use, generic over any marker carrying a `.subject`. A section stays active until the next heading or end of file, and assignment is by explicit heading position — **never by fixed question-number ranges**.

- Exactly two `#`, the literal word `Section` (case-sensitive), a colon, then the name.
- Horizontal whitespace only (`[ \t]`), so a malformed heading can never swallow the following line.
- The parser does **not** validate the section names or sizes. Any `## Section : X` heading defines a tag `X`. The 30/40/30 split in §3 is an observation about these six files, not an enforced rule (see `development-rules.md`: the parser must not know exam-level structure).
- A question appearing before the first heading would get `subject: null`, and `ADD_TAGS` would skip it as it does for any untagged question. This does not occur in the samples.

### Options

```js
const RRB_NTPC_OPTION_MARKER_SOURCE = "^([A-D])\\.[ \\t]+";
```

Uppercase `A`–`D`, a dot, then whitespace, **anchored to the start of a line** (`m` flag). `splitRrbNtpcOptions()` has the same shape as the other option splitters: the text before the first marker is the stem, and each option runs to the next marker or the end of the pre-answer text, then `trimEnd()`. Keys are the letters themselves.

Relationship-coding stems contain lines such as `A + B means ‘A is the son of B’` and `A ₹ B …` (S2 English Q77, S1 Hindi Q90, S3 Hindi Q78). They begin with a letter and a space, not a dot, so they do not match.

### Answers

The answer line is `**Ans.** C`. NTPC reuses **`splitAtUpscAnswerMarker()` unchanged** to split it off (its pattern, `^\*{0,2}Ans\.\*{0,2}\s*(.*)$`, accepts the bold form and yields the bare payload `C`). Resolution is NTPC's own:

```js
const RRB_NTPC_ANSWER_LETTER_PATTERN = /^[A-D]$/;
```

`resolveRrbNtpcCorrectAnswer()` returns the letter if the payload is exactly one of `A`–`D`, otherwise `null`. A missing, lowercase, parenthesized or otherwise malformed answer resolves to `null` rather than a guess (see §7).

### Section heading cut-off (fail-safe)

`truncateBeforeNextRrbNtpcSection()` cuts a block's content at the next section heading before options and answer are split. In a well-formed paper the next heading sits *after* the `**Ans.**` line, so it is already outside the part the parser keeps. The cut exists for one case: the last question of a section with a missing answer line, where, without it, the next heading would be absorbed into that question's last option. No sample exercises this; all 599 real questions have answer lines.

### Reused, unchanged

- `findQuestionBoundaries()` / `splitIntoBlocks()` — `**N.**` question markers, exam-agnostic.
- `splitAtUpscAnswerMarker()` — see above.
- `findSubjectForIndex()` — see above.
- `detectImage()` — zero images in all six samples (§3).

### Output shape

Every question is:

```
questionNumber        from the source, preserved exactly (1..100; Q80 absent in one file)
subject               nearest preceding "## Section : <Name>" text, verbatim
questionMarkdown      stem only, original markdown preserved (tables, LaTeX,
                       multi-line text, trailing hard-break spaces on interior lines)
questionOnlyMarkdown  byte-identical to questionMarkdown (kept for shape parity
                       with the group-capable exams)
type                  "MCQ" always
options               { A, B, C, D }
correctAnswer         "A" | "B" | "C" | "D" | null
hasImage / imageMarkdown   false / null in all six samples
group                 null always
```

**No Question Groups.** None of the six samples contains a Directions line, passage, common-data block or "questions N to M" range. "Statement I / Conclusion (I)" content and multi-line coding definitions are part of one question's own stem. Like GUJCET and Group D, `parseRrbNtpc()` has no group-assignment step. **No `NUMERICAL` type** appears either; every question is `MCQ`.

As elsewhere in the project, nothing is normalized: the parser records and splits, and does not rewrite or clean up Markdown. Question numbers are recorded exactly as they appear; there is no gap detection or filling.

---

## 3. Verified structure of the six sample files

All of the following was confirmed by direct inspection of the files and by a Node harness (`lib/parser.js` and `markingSchemes.js` loaded with `window` stubbed) run through the real `parseDocument()` path, compared question-by-question against an independent line-based reference extractor that shares no code with the parser.

| File (under `samples/RRB NTPC/`) | Language | Shift | Questions | Section headings (line) |
|---|---|---|---|---|
| `RRB_NTPC_UG_-_07-05-26_-_Shift_1_-_English.md` | English | 1 | 100 | L3 / L252 / L578 |
| `RRB NTPC UG - 07-05-26 - Shift 2 - English.md` | English | 2 | 100 | L3 / L253 / L575 |
| `RRB NTPC UG - 07-05-26 - Shift 3 - English.md` | English | 3 | 100 | L3 / L252 / L574 |
| `RRB NTPC UG - 07-05-26 - Shift 1 - Hindi.md` | Hindi | 1 | 100 | L3 / L252 / L578 |
| `RRB NTPC UG - 07-05-26 - Shift 2 - Hindi.md` | Hindi | 2 | 100 | L3 / L254 / L576 |
| `RRB NTPC UG - 08-05-26 - Shift 3 - Hindi.md` | Hindi | 3 | **99** | L3 / L252 / L574 |

Every title (line 1) is `RRB NTPC — CEN 07/2025 — Under Graduate Level (CBT I) — Shift N — <Language>`. (The Shift 1 English filename uses underscores where the other five use spaces; the parser never reads filenames.)

- **Numbering:** continuous across sections (no reset). Five files are 1–100 with no gaps or duplicates. See "Source anomaly" below for the sixth.
- **The three sections**, in this order, written as `## Section : <Name>` in all six files:

  | # | Section name, exactly as written (this is the tag) | Questions | Range |
  |---|---|---|---|
  | 1 | `Mathematics` | 30 | 1–30 |
  | 2 | `General Awareness` | 40 | 31–70 |
  | 3 | `General Intelligence and Reasoning` | 30 (29 in the 99-question file) | 71–100 |

  The heading syntax and names are identical across all six files and both languages. The first heading is on line 3, directly after the title; no question precedes it.
- **Options:** every question has exactly four, `A.`–`D.`, one per line, none empty, none duplicated within a question. **There is no blank line between the stem and option A**, and a blank line separates option D from the answer line.
- **Answers:** every question has an inline `**Ans.** X` line with X in `A`–`D`. No separate answer key, and no missing, cancelled, dropped or malformed answers.
- **Images:** none (`hasImage: false` for all 599). No `![](…)` or `<img>`. The two "Study the given diagram" questions (S1 English Q78, S2 English Q71, and their Hindi counterparts S1 Hindi Q97, S2 Hindi Q89) are transcribed as **Markdown tables inside the stem** (9 table lines each); no image exists to insert.
- **Tables:** four files carry one table question each (above); the two Shift 3 files have none. In S2 English Q71 and S2 Hindi Q89 the question sentence comes **before** the table; in S1 English Q78 and S1 Hindi Q97 it comes after. S2 Hindi Q89 also has English table cells and a glossary (`शिक्षकों =Teachers  `) between the table and the options.
- **Math:** LaTeX appears as `$…$`, always balanced. `₹` appears as a plain character, including as an operator symbol in Hindi coding questions.
- **Whitespace (preserved verbatim, not cleaned up):**
  - **Trailing double-spaces (Markdown hard breaks)** appear in three files: 327 lines in S2 English, 427 in S3 English, 47 in S2 Hindi. The other three files have none. Inside stems this is 27 hard-break line joins in each of S2 English and S3 English and 47 in S2 Hindi.
  - **Single-newline ("soft") line joins inside stems** with no hard break: 33 in S1 Hindi, 32 in S1 English, 45 in S3 Hindi, 14 in S2 English, 16 in S3 English, 1 in S2 Hindi. Whether Docxsity renders these as line breaks is unverified (§9).
  - A few stems contain blank lines inside the stem (for example S3 English Q82, Q84).
- **No stray `#` lines**, no in-stem digit-numbered or roman-numeral lists, and no line beginning with a Mermaid keyword (the Docxsity "pie" collision documented in [debugging-notes.md](debugging-notes.md)) in any of the six files.
- **File hygiene:** LF line endings, no BOM, tabs, NBSP, zero-width or control characters.

### Source anomaly: Q80 absent from one Hindi file

`RRB NTPC UG - 08-05-26 - Shift 3 - Hindi.md` has **no Q80**: line 659 is Q79 and line 667 is Q81, and no marker for Q80 exists anywhere in the file. It parses as 99 questions, numbered 1–79 and 81–100, with 29 questions in the last section. The parser records the numbers that appear in the source and does nothing about the gap — nothing is invented, renumbered or filled, and no special-case logic exists for it. Operationally the gap is handled by existing behavior (see [decisions.md](decisions.md), "`jumpToQuestion()` resolves by `questionNumber` value"): Jump by number works across it, and a request for 80 fails with a clear "does not exist" message. The panel's "Question N / Total" display is position-based and will read one lower than the source number after the gap.

**Scope of this claim:** facts about these six files only.

---

## 4. Runtime integration — Docxsity only

**No RRB-NTPC-specific runtime code was written anywhere, and none was needed.** The flow is:

```
parseRrbNtpc()  →  standard Question Object  →  existing Docxsity MCQ flow
```

- `PREPARE_FORM` looks up `MarkingSchemes.getMarkingScheme("RRB_NTPC", "MCQ")` and fills Marks `1` / Penalty `0.33` (or the Settings override), using the existing MCQ Question Type selection.
- `PASTE_QUESTION` / `PASTE_OPTIONS` / `MARK_CORRECT` / `GENERATE_AI` run as for any standalone MCQ. `group` is `null`, so no Question Group logic is involved.
- `ADD_TAGS` writes `question.subject` into the Tags field and waits for a tag pill with that exact text — the unchanged state documented in [docxsity.md](docxsity.md). The three section names reach it as the subject.
- Settings (Marks/Penalty overrides, feature toggles) and Slideshow are exam-agnostic and unaffected.

**No Modality integration exists, and RRB NTPC is not supported on Modality.** `sites/modality/*` was not touched. Because `lib/parser.js` is shared, a file with an RRB NTPC title would still be detected as `RRB_NTPC` if loaded there; Modality has no marking-scheme entry for it and falls back to its default (`4` / `1`), which is not NTPC's scheme. RRB NTPC should not be uploaded through Modality — the same pre-existing condition that applies to the other Docxsity-only exam types.

---

## 5. Validation

**Read this section's headers carefully — the distinction between them is load-bearing**, the same convention [nda-mathematics.md](nda-mathematics.md) §5 and [rrb-group-d.md](rrb-group-d.md) §5 established.

### STATIC / PARSER VALIDATION (all six files, 599 questions)

A Node harness required `lib/parser.js` and `sites/docxsity/config/markingSchemes.js` directly (no browser) and ran the real `parseDocument()` against each file, comparing every question with an independent reference extractor. **Result: 9,058 checks passed, 0 failed.** Per file:

- `detectExamType()` and `parseDocument()` both report `RRB_NTPC`.
- 100 questions with `questionNumber` 1..100 in order; 99 for the Hindi Shift 3 file with Q80 absent and none invented.
- Number of `**Ans.**` lines equals the question count.
- Exactly four non-empty options per question, each equal to the reference; none contains an answer line, section-heading text or a question marker.
- `correctAnswer` resolved to `A`–`D` for every question and equal to the reference.
- `subject` equal to the nearest preceding heading for every question, with exactly the three §3 values and counts 30/40/30 (30/40/29).
- `type: "MCQ"`, `group: null`, `hasImage: false`, `imageMarkdown: null`, and `questionOnlyMarkdown === questionMarkdown` for every question.
- `questionMarkdown` equal to the reference stem for all 599 questions, and a substring of the source file.
- **Whole-file round trip:** the non-blank lines of each file (minus the title, section headings and answer lines), compared against the parsed stems and options in order, are identical — nothing lost, duplicated or reordered.
- Interior trailing double-spaces (hard breaks) in stems match the source count in every file, and every `|` table line in the source is inside a stem.
- `getMarkingScheme("RRB_NTPC", "MCQ")` returns `{ marks: "1", penalty: "0.33" }`; `RRB_GROUP_D` is unchanged; an unknown exam type still returns `null`.
- Title detection: `RRB NTPC …` (including a Graduate-level / CBT-II-shaped title and a lowercase variant) → `RRB_NTPC`; `RRB Group D — …` → `RRB_GROUP_D`; `RRB NTPCX …`, `RRB NTPC2 …`, `Mock RRB NTPC Paper`, `RRB ALP …` and `RRB JE …` → `null`.

### REGRESSION

`parseDocument()`'s output was captured for every `.md` sample in `samples/` other than the six NTPC files (71 files, including the six RRB Group D files) immediately before and after the change, comparing detected type, exam type, question count, and a SHA-256 of the full serialized result. **Zero differences across all 71**; the six Group D files still detect as `RRB_GROUP_D` with 100 questions each; the one sample that detected as `null` before still does. `node --check` passes on both edited files.

The harness and snapshots were ad hoc scripts run outside the repository; they are **not committed** and the repository has no test runner, so this validation is reproducible only by re-writing the same comparison.

### LIVE DOCXSITY VALIDATION — **not performed**

No RRB NTPC question has been run through Docxsity. Everything about how Docxsity displays or accepts NTPC content is unverified; see §9.

---

## 6. Files changed

| File | Touched for |
|---|---|
| `lib/parser.js` | `RRB_NTPC_TITLE_PATTERN` and its `detectExamType()` branch; the RRB NTPC parser block (`parseRrbNtpc` and helpers, 148 lines added), the `parseDocument()` route, the `parseRrbNtpc` export. Purely additive; no existing line modified |
| `sites/docxsity/config/markingSchemes.js` | One `RRB_NTPC` entry added |
| `samples/RRB NTPC/*.md` | The six source samples every claim in this document rests on (not modified by this work) |
| `docs/rrb-ntpc.md` | This document (plus a one-sentence cross-reference in `docs/docxsity.md`, and two statements in `docs/rrb-group-d.md` §1 and §5 corrected to say an NTPC title is no longer `null`) |

Nothing was changed in `lib/session.js`, `lib/settings.js`, `content/*`, `manifest.json`, `sites/docxsity/{stateMachine,selectors,domHelpers}.js`, any file under `sites/modality/*`, any RRB Group D sample, or any other exam's parser code.

---

## 7. Comparison with RRB Group D

The grammars that matter to the parser are the same shape — which is why `parseRrbNtpc()` needed no new parsing technique — but every constant is NTPC's own (§1).

| Aspect | RRB Group D | RRB NTPC |
|---|---|---|
| Title | `RRB Group D — CEN 09/2025 — Shift N (SN) — Lang` | `RRB NTPC — CEN 07/2025 — Under Graduate Level (CBT I) — Shift N — Lang` |
| Section heading | `## Section : <Name>` | same |
| Sections | 4 (25/25/30/20) | 3 (30/40/30) |
| Tag names | General Science, Mathematics, General Intelligence and Reasoning, General Awareness and Current Affairs | Mathematics, General Awareness, General Intelligence and Reasoning |
| Question / answer markers | `**N.**` / `**Ans.** X` | same |
| Blank line between stem and options | Yes | **No** |
| Trailing double-spaces | None | Present in 3 of 6 files |
| Stray `#` lines, in-stem `1.`/`I.` lists | Present in some files | None |
| Sequence gaps | None | One file missing Q80 |

---

## 8. Design decisions specific to RRB NTPC

- **NTPC gets its own parser path (`parseRrbNtpc`)** and does not call, share a constant with, or route through `parseRrb()`, per the project's standing convention.
- **Section names are the tags, verbatim**, including for Hindi papers (which therefore get English tags). There is no canonical-name map and no hardcoded list of the three names; assignment is by explicit heading boundary, never by question-number range. Note `General Awareness` differs from Group D's `General Awareness and Current Affairs` — they are deliberately not unified.
- **Reuse the existing subject lookup**, not a new tagging system. Only the marker regex is NTPC-specific.
- **No Markdown cleanup.** Trailing hard-break spaces, tables, LaTeX and blank lines inside stems are preserved byte-for-byte. If they render badly on Docxsity, the fix belongs in the source Markdown, not in a parser heuristic.
- **No special handling for the missing Q80.** It is a source anomaly, recorded as-is (§3).
- **Title pattern is not restricted by level.** A Graduate-level or CBT-2 NTPC title would also be routed here; see §9.
- **`group: null` always, `type: "MCQ"` always**, because the corpus contains neither groups nor numerical questions.

---

## 9. Known limitations / still unverified

- **Nothing has been live-tested on Docxsity** (§5). Parser-level correctness is established; Docxsity behavior is not.
- **Multi-word tag handling is unverified** — `General Intelligence and Reasoning` is 34 characters. `runAddTags()` waits for a tag pill whose trimmed text equals the subject exactly (`tagPill(subject)` in `selectors.js`, a `span` matched by text); it has not been checked whether Docxsity trims, re-cases, truncates or limits tag text, or whether another `span` with the exact text `Mathematics` could satisfy the wait early. This is the same open item [rrb-group-d.md](rrb-group-d.md) §9 carries.
- **Line-break rendering is unverified.** Three files use hard breaks (trailing double-spaces) and three do not; stems in the latter rely on single newlines. How Docxsity's editor renders either is unknown.
- **Table-question rendering is unverified** (S1 English Q78, S2 English Q71, S1 Hindi Q97, S2 Hindi Q89), as are `$…$` LaTeX and the `₹` character.
- **If any rendering issue matters, the fix is in the source Markdown, not the parser** (§8).
- **Only CEN 07/2025, Under Graduate Level, CBT-1 has been seen.** A Graduate-level or CBT-2 paper — whose sections, question count and marking scheme have not been seen — would be detected as `RRB_NTPC` and parsed by section heading, but nothing here is a guarantee for it, and its marking scheme may differ from `1`/`0.33`.
- **Marking scheme is a stated value, not an observed one** (§1).
- **Option-format assumptions.** `parseRrbNtpc()` assumes exactly the `A.`–`D.` uppercase, line-start convention seen in all 599 samples. A stem line that itself begins with `A. ` would be read as the first option. A fifth option (`E.`) would not match and would be absorbed into option D's text — silently. Neither occurs in the samples.
- **Section names and sizes are not validated.** A misspelled or extra `## Section : …` heading simply creates another tag value; a missing heading leaves later questions under the previous section.
- **Q80 is absent from the Hindi Shift 3 sample** (§3); an operator who needs it must source it separately.
- **Modality is unsupported** (§4).
- **Difficulty is not automated**, as for every other exam type on Docxsity.

---

## 10. Future work

- Run a representative live Docxsity pass: first one question from the last section to check the long multi-word tag (§9); then S2 English Q71 (table), a question with `$` math, one with hard breaks and one with only soft breaks, then a normal multi-question run. Hindi should be exercised explicitly, since only parser-level coverage exists for it.
- Decide, based on that pass, whether any source-Markdown fixes are needed.
- If further NTPC papers (Graduate level, CBT-2) are added, re-validate against them before assuming §3's structure holds, and add them to this document's sample table.

---

## Current status

**RRB NTPC (CEN 07/2025, Under Graduate Level, CBT-1) parser and marking scheme are implemented and statically validated; live Docxsity validation has not been performed.**

- Parser (`parseRrbNtpc` and helpers) — complete; all 599 questions across the six sample files match an independent reference, with a whole-file round trip.
- Marking scheme (Marks 1 / Penalty 0.33) — configured in `sites/docxsity/config/markingSchemes.js`.
- Section tagging — implemented via the existing `findSubjectForIndex()` lookup; tag handling for the multi-word names is unverified on the live site.
- Regression — zero drift across the 71 other samples, including the six RRB Group D files.
- **No Modality support** — Docxsity-only.
- **Not committed.**
