(function () {
  const QUESTION_MARKER_SOURCE = "^\\*\\*(\\d+)\\.\\*\\*\\s*";
  const OPTION_MARKER_SOURCE = "^\\(([1-4])\\)\\s*";
  const ANSWER_MARKER_SOURCE = "^Ans\\.\\s*\\(([^)]*)\\)";
  const SECTION_MARKER_SOURCE = "^#{1,6}\\s*SECTION[\\s-]+([A-Za-z])\\s*$";
  const SUBJECT_MARKER_SOURCE = "^#{1,6}\\s*(Physics|Chemistry|Mathematics)\\s*$";
  const DIGIT_TO_LETTER = { 1: "A", 2: "B", 3: "C", 4: "D" };
  const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\([^)]*\)/;
  const HTML_IMAGE_PATTERN = /<img\b[^>]*>/i;
  const SECTION_TYPE_BY_LETTER = { A: "MCQ", B: "NUMERICAL" };
  const SUBJECT_CANONICAL_BY_UPPER = { PHYSICS: "Physics", CHEMISTRY: "Chemistry", MATHEMATICS: "Mathematics" };

  function findQuestionBoundaries(rawMarkdown) {
    const pattern = new RegExp(QUESTION_MARKER_SOURCE, "gm");
    const boundaries = [];
    let match;

    while ((match = pattern.exec(rawMarkdown)) !== null) {
      boundaries.push({
        index: match.index,
        contentStart: match.index + match[0].length,
        questionNumber: Number(match[1]),
      });
    }

    return boundaries;
  }

  function splitIntoBlocks(rawMarkdown) {
    const boundaries = findQuestionBoundaries(rawMarkdown);

    return boundaries.map((boundary, i) => {
      const blockEnd = i + 1 < boundaries.length ? boundaries[i + 1].index : rawMarkdown.length;

      return {
        questionNumber: boundary.questionNumber,
        index: boundary.index,
        rawBlock: rawMarkdown.slice(boundary.index, blockEnd),
        content: rawMarkdown.slice(boundary.contentStart, blockEnd),
      };
    });
  }

  function findSectionMarkers(rawMarkdown) {
    const pattern = new RegExp(SECTION_MARKER_SOURCE, "gim");
    const markers = [];
    let match;

    while ((match = pattern.exec(rawMarkdown)) !== null) {
      markers.push({
        index: match.index,
        letter: match[1].toUpperCase(),
      });
    }

    return markers;
  }

  function findSectionLetterForIndex(sectionMarkers, index) {
    let current = null;

    for (const marker of sectionMarkers) {
      if (marker.index > index) {
        break;
      }
      current = marker;
    }

    return current ? current.letter : null;
  }

  function findSubjectMarkers(rawMarkdown) {
    const pattern = new RegExp(SUBJECT_MARKER_SOURCE, "gim");
    const markers = [];
    let match;

    while ((match = pattern.exec(rawMarkdown)) !== null) {
      markers.push({
        index: match.index,
        subject: SUBJECT_CANONICAL_BY_UPPER[match[1].toUpperCase()],
      });
    }

    return markers;
  }

  function findSubjectForIndex(subjectMarkers, index) {
    let current = null;

    for (const marker of subjectMarkers) {
      if (marker.index > index) {
        break;
      }
      current = marker;
    }

    return current ? current.subject : null;
  }

  function splitAtAnswerMarker(content) {
    const pattern = new RegExp(ANSWER_MARKER_SOURCE, "m");
    const match = pattern.exec(content);

    if (!match) {
      return { beforeAnswer: content, answerValue: null };
    }

    const beforeAnswer = content.slice(0, match.index).trimEnd();
    const answerValue = match[1].trim();

    return {
      beforeAnswer,
      answerValue: answerValue.length > 0 ? answerValue : null,
    };
  }

  function splitOptions(beforeAnswer) {
    const pattern = new RegExp(OPTION_MARKER_SOURCE, "gm");
    const matches = [];
    let match;

    while ((match = pattern.exec(beforeAnswer)) !== null) {
      matches.push({
        digit: match[1],
        index: match.index,
        contentStart: match.index + match[0].length,
      });
    }

    if (matches.length === 0) {
      return { questionMarkdown: beforeAnswer.trimEnd(), options: null };
    }

    const questionMarkdown = beforeAnswer.slice(0, matches[0].index).trimEnd();
    const options = { A: null, B: null, C: null, D: null };

    matches.forEach((optionMatch, i) => {
      const optionEnd = i + 1 < matches.length ? matches[i + 1].index : beforeAnswer.length;
      const letter = DIGIT_TO_LETTER[optionMatch.digit];
      options[letter] = beforeAnswer.slice(optionMatch.contentStart, optionEnd).trimEnd();
    });

    return { questionMarkdown, options };
  }

  function resolveCorrectAnswer(answerValue, options) {
    if (answerValue === null) {
      return null;
    }

    if (options && DIGIT_TO_LETTER[answerValue]) {
      return DIGIT_TO_LETTER[answerValue];
    }

    return answerValue;
  }

  function detectImage(rawBlock) {
    const markdownMatch = rawBlock.match(MARKDOWN_IMAGE_PATTERN);
    const htmlMatch = rawBlock.match(HTML_IMAGE_PATTERN);

    let firstMatch = null;

    if (markdownMatch && htmlMatch) {
      firstMatch = markdownMatch.index <= htmlMatch.index ? markdownMatch[0] : htmlMatch[0];
    } else if (markdownMatch) {
      firstMatch = markdownMatch[0];
    } else if (htmlMatch) {
      firstMatch = htmlMatch[0];
    }

    return {
      hasImage: firstMatch !== null,
      imageMarkdown: firstMatch,
    };
  }

  function determineType(sectionLetter) {
    if (sectionLetter && SECTION_TYPE_BY_LETTER[sectionLetter]) {
      return SECTION_TYPE_BY_LETTER[sectionLetter];
    }

    return "UNKNOWN";
  }

  function parseBlock(block, sectionMarkers, subjectMarkers) {
    const { beforeAnswer, answerValue } = splitAtAnswerMarker(block.content);
    const { questionMarkdown, options } = splitOptions(beforeAnswer);
    const { hasImage, imageMarkdown } = detectImage(block.rawBlock);
    const correctAnswer = resolveCorrectAnswer(answerValue, options);
    const sectionLetter = findSectionLetterForIndex(sectionMarkers, block.index);
    const type = determineType(sectionLetter);
    const subject = findSubjectForIndex(subjectMarkers, block.index);

    return {
      questionNumber: block.questionNumber,
      subject,
      questionMarkdown,
      type,
      options,
      correctAnswer,
      hasImage,
      imageMarkdown,
    };
  }

  function parse(rawMarkdown) {
    if (typeof rawMarkdown !== "string") {
      return [];
    }

    const sectionMarkers = findSectionMarkers(rawMarkdown);
    const subjectMarkers = findSubjectMarkers(rawMarkdown);

    return splitIntoBlocks(rawMarkdown).map((block) => parseBlock(block, sectionMarkers, subjectMarkers));
  }

  // --- UPSC (separate internal execution path — does not touch anything above) ---

  // ASSUMPTION: exactly 4 options, lettered a-d, one per paper seen so far
  // (2023 and 2025, Paper I and II, both languages). A 5th option (e) or a
  // different lettering scheme would not error — it would silently be
  // absorbed into the text of whichever option precedes it, since this
  // regex simply never matches it as a marker.
  const UPSC_OPTION_MARKER_SOURCE = "^\\(([a-d])\\)\\s*";
  const LOWERCASE_TO_LETTER = { a: "A", b: "B", c: "C", d: "D" };
  // Both languages render the paper number as a Latin-script Roman numeral
  // ("Paper I" / "Paper II") even in the Hindi title, so this needs no
  // per-language variant. "II" is checked before "I" so "Paper II" is never
  // mistaken for "Paper I" (a bare word-boundary check on "I" alone would
  // still fail correctly here, since the character after that "I" in
  // "Paper II" is another word character and breaks the \b — but matching
  // "II" first keeps the intent explicit).
  // ASSUMPTION: only recognizes the spelled-out "Paper I"/"Paper II" form
  // seen in all samples so far. A title using digits ("Paper 1"), a hyphen
  // ("Paper-I"), or an abbreviation ("GS-I") would not match — detectExamType
  // would then fall through to returning null for the whole document.
  const PAPER_NUMBER_PATTERN = /Paper\s+(II|I)\b/i;
  // A standalone line naming a passage: e.g. "Passage – 1" (2025 English,
  // en dash, spaced), "Passage—1" (2024 English, em dash, unspaced), or
  // "परिच्छेद—1" (Hindi). The word itself differs by language and the dash
  // glyph differs by year/source, but the shape — one word, a dash, a
  // number, nothing else on the line — is identical across all of them, so
  // this is matched structurally rather than by hardcoding either the word
  // or a specific dash character. `\p{Pd}` (Unicode "Dash Punctuation"
  // category) matches hyphen-minus, en dash, em dash, and other dash
  // variants alike, so a future paper using yet another dash glyph needs no
  // new branch here — intentionally NOT special-cased per year.
  // Requires the "u" flag on every RegExp compiled from this source (or any
  // pattern combining it), since \p{...} is only valid under that flag.
  // Verified against all six sample papers seen so far (2023/2024/2025):
  // zero false positives in the (passage-free) Paper I samples.
  // ASSUMPTION: the label before the dash is a single whitespace-free token
  // (\S+) — a future paper using a two-word label (e.g. "Reading Passage –
  // 1") would not match this marker at all, so its passage would silently
  // fail to attach to any question rather than erroring.
  const PASSAGE_MARKER_SOURCE = "^\\s*\\S+\\s*\\p{Pd}\\s*(\\d+)\\s*$";
  // A "Directions for the following N (word) items :" line (English) or its
  // Hindi equivalent: a number immediately followed by a parenthesized word,
  // with the line ending in a colon. Same reasoning as above — matched by
  // shape, not by language-specific wording. This line declares how many of
  // the immediately following questions are governed by the passage(s) that
  // follow it.
  // ASSUMPTION/TODO: the declared item count N is trusted as-is and never
  // cross-checked against where the passages actually end — a typo'd count
  // in the source markdown would misattribute passage boundaries with no
  // way for the parser to notice. The leading non-greedy `.*?` also assumes
  // exactly one "digit + (word) + :" shape per line; a Directions-style line
  // with a second number before the trailing colon could match the wrong
  // span. Only the wording shapes seen in the 2023/2025 samples are covered.
  const DIRECTIONS_MARKER_SOURCE = "^.*?(\\d+)\\s*\\([^)\\n]*\\)[^:\\n]*:\\s*$";

  // NDA & NA Examination titles look like "N.D.A. & N.A. Examination (I),
  // 2025 – Mathematics (English)" / "...(Hindi)". Deliberately
  // sitting-agnostic: "(I)"/"(II)" denotes which exam sitting produced this
  // particular paper (NDA runs two sittings a year), not a Paper I/II format
  // distinction the way UPSC's title does — so it's never matched or
  // captured here, mirroring how UPSC_PAPER_I already matches every year's
  // Paper I without a year-specific branch. A title must ALSO contain
  // "Mathematics" (checked separately below) to be recognized — this is
  // what keeps a future NDA General Ability Test paper (a different, not
  // yet supported subject/format) correctly falling through to `null`
  // rather than being misclassified as this exam type.
  const NDA_TITLE_PATTERN = /N\.?\s*D\.?\s*A\.?\s*&\s*N\.?\s*A\.?\s*Examination/i;

  // CAT titles look like "CAT 2025 – Slot 1". Deliberately slot-agnostic —
  // "Slot 1"/"Slot 2"/etc. is never matched or captured, the same
  // sitting-agnostic convention NDA_TITLE_PATTERN already established for
  // "(I)"/"(II)". Anchored on "CAT" immediately followed by a 4-digit year
  // (not a bare /CAT/i substring test) specifically so an unrelated title
  // containing "CAT" as a word fragment (e.g. "...Category...") can never
  // match — verified no collision against JEE/UPSC/NDA_TITLE_PATTERN's own
  // real sample titles. Tested against `title` (the line already stripped
  // of its leading "#" by the extraction below), matching every other
  // title pattern's own convention in this function — not against the raw
  // "# CAT 2025 – Slot 1" heading line itself.
  const CAT_TITLE_PATTERN = /^CAT\s+\d{4}/i;

  // INTENTIONAL: an unrecognized title (neither "JEE" nor "UPSC"/"Civil
  // Services" nor "N.D.A. & N.A. Examination" + "Mathematics", or a UPSC
  // title without a matching Paper I/II) falls through to `null` here on
  // purpose — parseDocument then returns zero questions rather than
  // guessing which exam's rules to apply to unrecognized content. This is a
  // deliberate fail-closed default, not a gap to patch.
  //
  // When adding support for a new exam: extend this function with a new
  // branch (and a new returned examType constant), and give that exam its
  // own dedicated parser function — mirroring how UPSC's own parseUpsc
  // sits alongside JEE's parse below rather than being folded into it.
  // Never grow an existing exam's parsing logic (parse / parseUpsc) to
  // also cover a different exam's format.
  function detectExamType(rawMarkdown) {
    if (typeof rawMarkdown !== "string") {
      return null;
    }

    const titleMatch = rawMarkdown.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : "";

    if (/JEE/i.test(title)) {
      return "JEE";
    }

    if (/UPSC|Civil Services/i.test(title)) {
      const paperMatch = title.match(PAPER_NUMBER_PATTERN);

      if (paperMatch) {
        return paperMatch[1].toUpperCase() === "II" ? "UPSC_PAPER_II" : "UPSC_PAPER_I";
      }
    }

    if (NDA_TITLE_PATTERN.test(title) && /Mathematics/i.test(title)) {
      return "NDA_MATHEMATICS";
    }

    // GAT titles look like "N.D.A. & N.A. Examination (I), 2025 – General
    // Ability Test English" / "...Hindi" — same NDA_TITLE_PATTERN prefix,
    // sitting-agnostic for the same reason NDA_MATHEMATICS is, distinguished
    // from it purely by the "General Ability Test" substring rather than
    // "Mathematics". The two checks are mutually exclusive by construction
    // (verified against both real GAT titles: neither contains
    // "Mathematics", and NDA_MATHEMATICS's own titles don't contain
    // "General Ability Test"), so branch order between them doesn't matter.
    if (NDA_TITLE_PATTERN.test(title) && /General Ability Test/i.test(title)) {
      return "NDA_GAT";
    }

    if (CAT_TITLE_PATTERN.test(title)) {
      return "CAT";
    }

    return null;
  }

  function findDirectionsMarkers(rawMarkdown) {
    const pattern = new RegExp(DIRECTIONS_MARKER_SOURCE, "gm");
    const markers = [];
    let match;

    while ((match = pattern.exec(rawMarkdown)) !== null) {
      markers.push({ index: match.index, itemCount: Number(match[1]) });
    }

    return markers;
  }

  function findPassageMarkers(rawMarkdown) {
    const pattern = new RegExp(PASSAGE_MARKER_SOURCE, "gmu");
    const markers = [];
    let match;

    while ((match = pattern.exec(rawMarkdown)) !== null) {
      markers.push({ index: match.index, contentStart: match.index + match[0].length });
    }

    return markers;
  }

  // Every raw "Passage – N" occurrence in document order, each given a
  // stable identity (`id`, simply its position among all passages in the
  // document) distinct from its printed number. This is the single source
  // both computePassageAssignments consumers below are built from, so the
  // legacy passage-duplication map and the new Question Group metadata can
  // never disagree about which passage is which.
  function findPassages(rawMarkdown, questionBoundaries) {
    const rawPassageMarkers = findPassageMarkers(rawMarkdown);

    return rawPassageMarkers.map((marker, i) => {
      const nextPassageIndex = i + 1 < rawPassageMarkers.length ? rawPassageMarkers[i + 1].index : Infinity;
      const nextQuestionBoundary = questionBoundaries.find((boundary) => boundary.index > marker.index);
      const nextQuestionIndex = nextQuestionBoundary ? nextQuestionBoundary.index : Infinity;
      const end = Math.min(nextPassageIndex, nextQuestionIndex);

      return {
        id: i,
        index: marker.index,
        text: rawMarkdown.slice(marker.contentStart, end).trim(),
      };
    });
  }

  // Assigns each passage-governed question to the specific passage (by
  // identity, not just text) that governs it. The "Directions for the
  // following N items" line is what bounds how many of the following
  // questions a passage governs — without it, there is no way to tell a
  // passage-governed question apart from a plain question that merely
  // happens to follow a passage elsewhere in the paper.
  // NOTE: the passage's own printed number ("Passage – 1" vs "– 2") is
  // captured by PASSAGE_MARKER_SOURCE but never actually read here —
  // attribution relies purely on document order (nearest preceding passage
  // marker within the block), not on matching numbers. This holds for every
  // sample seen (passages are always presented in the same order as the
  // questions that use them) but would misattribute if a paper ever printed
  // "Passage – 2" before "Passage – 1" for some reason.
  // This is the one place that decides passage attribution — both
  // passageTextByQuestionIndex (legacy) and questionGroupsByQuestionIndex
  // (new) are derived from its output, so they can't drift apart.
  function computePassageAssignments(rawMarkdown, questionBoundaries) {
    const directionsMarkers = findDirectionsMarkers(rawMarkdown);
    const passages = findPassages(rawMarkdown, questionBoundaries);
    const assignments = [];

    directionsMarkers.forEach((directionsMarker, i) => {
      const blockEnd = i + 1 < directionsMarkers.length ? directionsMarkers[i + 1].index : Infinity;

      const governedQuestions = questionBoundaries
        .filter((boundary) => boundary.index > directionsMarker.index && boundary.index < blockEnd)
        .slice(0, directionsMarker.itemCount);

      const blockPassages = passages.filter((passage) => passage.index > directionsMarker.index && passage.index < blockEnd);

      governedQuestions.forEach((question) => {
        const passage = blockPassages
          .filter((candidate) => candidate.index < question.index)
          .slice(-1)[0];

        if (passage) {
          assignments.push({ question, passage });
        }
      });
    });

    return assignments;
  }

  // LEGACY (compatibility layer, kept only until the Question Group upload
  // path below has been implemented and validated against real uploads —
  // see the TODO on parseUpscBlock's fullQuestionMarkdown). Every parsed
  // UPSC question must be self-contained under today's flattened upload
  // model, so a passage shared by several questions is duplicated into
  // each one rather than referenced.
  function passageTextByQuestionIndex(assignments) {
    const map = new Map();

    assignments.forEach(({ question, passage }) => {
      map.set(question.index, passage.text);
    });

    return map;
  }

  // NEW (not yet consumed anywhere): groups passage-governed questions by
  // the specific passage that governs them, in document order. This is the
  // data the future Question Group upload path needs — which original,
  // independently-numbered questions share one Instruction/Title block on
  // the website, and which one is first (the only valid site-side entry
  // point into that group, since a Question Group must be created
  // sequentially starting from its first sub-question). Purely additive:
  // attached to each question as an inert `group` field. questionMarkdown
  // keeps including the duplicated passage text regardless.
  function questionGroupsByQuestionIndex(assignments) {
    const questionsByPassageId = new Map();

    assignments.forEach(({ question, passage }) => {
      if (!questionsByPassageId.has(passage.id)) {
        questionsByPassageId.set(passage.id, { passage, questions: [] });
      }
      questionsByPassageId.get(passage.id).questions.push(question);
    });

    const groupByQuestionIndex = new Map();

    questionsByPassageId.forEach(({ passage, questions }) => {
      const ordered = questions.slice().sort((a, b) => a.index - b.index);
      const questionNumbers = ordered.map((question) => question.questionNumber);

      ordered.forEach((question, position) => {
        groupByQuestionIndex.set(question.index, {
          id: passage.id,
          instructionMarkdown: passage.text,
          questionNumbers,
          isFirstInGroup: position === 0,
          isLastInGroup: position === ordered.length - 1,
        });
      });
    });

    return groupByQuestionIndex;
  }

  // A question's own raw block (bounded only by the next "**N.**" marker)
  // can trail into the *next* question's "Directions.../Passage – N"
  // preamble, since those marker lines sit between one question's last
  // option and the next question marker, not between two question
  // boundaries of their own. That trailing preamble belongs to the
  // following question (as its passage), never to this one's last option —
  // so it must be cut off before options are split out. Shares
  // PASSAGE_MARKER_SOURCE's dash tolerance (see its comment above), so this
  // combined pattern also needs the "u" flag.
  const PASSAGE_OR_DIRECTIONS_PATTERN = new RegExp(`${DIRECTIONS_MARKER_SOURCE}|${PASSAGE_MARKER_SOURCE}`, "mu");

  function truncateBeforeNextQuestionMetadata(content) {
    const match = PASSAGE_OR_DIRECTIONS_PATTERN.exec(content);
    return match ? content.slice(0, match.index).trimEnd() : content;
  }

  function splitUpscOptions(beforeAnswer) {
    const pattern = new RegExp(UPSC_OPTION_MARKER_SOURCE, "gm");
    const matches = [];
    let match;

    while ((match = pattern.exec(beforeAnswer)) !== null) {
      matches.push({
        letter: match[1],
        index: match.index,
        contentStart: match.index + match[0].length,
      });
    }

    if (matches.length === 0) {
      return { questionMarkdown: beforeAnswer.trimEnd(), options: null };
    }

    const questionMarkdown = beforeAnswer.slice(0, matches[0].index).trimEnd();
    const options = { A: null, B: null, C: null, D: null };

    matches.forEach((optionMatch, i) => {
      const optionEnd = i + 1 < matches.length ? matches[i + 1].index : beforeAnswer.length;
      const letter = LOWERCASE_TO_LETTER[optionMatch.letter];
      options[letter] = beforeAnswer.slice(optionMatch.contentStart, optionEnd).trimEnd();
    });

    return { questionMarkdown, options };
  }

  // UPSC answer-key lines aren't written one consistent way across years:
  // 2025 papers omit them entirely, while this 2023 paper bolds the marker
  // ("**Ans.** (a)") instead of JEE's plain "Ans. (2)". The marker itself
  // (asterisks aside) is the literal word "Ans." in every sample seen so
  // far, including the Hindi ones — only the dropped-question sentence
  // after it is translated — so no per-language variant is needed here.
  // This is intentionally a separate, more tolerant pattern from JEE's own
  // ANSWER_MARKER_SOURCE rather than a change to it, since JEE's format is
  // consistently plain and doesn't need this tolerance.
  // ASSUMPTION: only tolerates 0-2 literal asterisks around "Ans." itself.
  // A still-different future format — a translated marker word, "Answer:",
  // "Key:", underscore-italics ("_Ans._") — would not match at all. That
  // fails gracefully (answerText stays null, correctAnswer stays null, same
  // as a paper with no answer key), never incorrectly, but it does mean a
  // real answer key could be silently missed rather than surfaced as an
  // error. Revisit this pattern the same way this format was added, if/when
  // another UPSC year turns out to use a format not covered here.
  const UPSC_ANSWER_LINE_SOURCE = "^\\*{0,2}Ans\\.\\*{0,2}\\s*(.*)$";
  const UPSC_ANSWER_LETTER_PATTERN = /^\(([a-dA-D])\)$/;

  function splitAtUpscAnswerMarker(content) {
    const pattern = new RegExp(UPSC_ANSWER_LINE_SOURCE, "m");
    const match = pattern.exec(content);

    if (!match) {
      return { beforeAnswer: content, answerText: null };
    }

    const beforeAnswer = content.slice(0, match.index).trimEnd();
    const answerText = match[1].trim();

    return { beforeAnswer, answerText: answerText.length > 0 ? answerText : null };
  }

  // A minority of UPSC questions are officially dropped ("Question dropped
  // by UPSC (no key awarded)" / its Hindi equivalent) — genuinely no answer,
  // not a parsing failure. Only a line whose entire payload is exactly one
  // of (a)-(d) counts as a real answer; any other trailing text (dropped
  // notices included, which themselves contain parentheses) resolves to
  // null and is handled identically to a paper with no answer key at all.
  // ASSUMPTION: this only ever resolves a single letter. UPSC has, on rare
  // historical occasions, awarded marks for more than one option on a
  // disputed question — that would be written as something other than a
  // lone "(a)"-"(d)" and would resolve to null here (safe fallback to
  // manual marking), not an error, but it is a real answer being discarded.
  function resolveUpscCorrectAnswer(answerText) {
    if (answerText === null) {
      return null;
    }

    const letterMatch = answerText.match(UPSC_ANSWER_LETTER_PATTERN);

    if (!letterMatch) {
      return null;
    }

    return LOWERCASE_TO_LETTER[letterMatch[1].toLowerCase()];
  }

  // NOTE: none of the 6 sample papers studied (2023/2025, Paper I/II, both
  // languages) contain a question with missing options or an embedded
  // image. splitUpscOptions returning `options: null` (→ runPasteOptions'
  // graceful stop) and detectImage returning hasImage:true (→ PREPARE_FORM's
  // manual-insert stop) are both inherited for free from the shared/JEE code
  // paths, but neither has been exercised against real UPSC content — only
  // reasoned about from the spec. Worth confirming against a real example
  // if one turns up.
  function parseUpscBlock(block, passageByQuestionIndex, groupByQuestionIndex) {
    const ownContent = truncateBeforeNextQuestionMetadata(block.content);
    const { beforeAnswer, answerText } = splitAtUpscAnswerMarker(ownContent);
    const { questionMarkdown, options } = splitUpscOptions(beforeAnswer);
    const { hasImage, imageMarkdown } = detectImage(block.rawBlock);
    const correctAnswer = resolveUpscCorrectAnswer(answerText);
    const passageText = passageByQuestionIndex.get(block.index) || null;
    // LEGACY (compatibility layer): passage folded directly into this
    // question's own questionMarkdown, exactly as before Question Group
    // support existed — see passageTextByQuestionIndex above.
    // TODO(question-groups): once the Question Group upload path (below,
    // via the `group` field) has been implemented and validated against
    // real uploads, stop duplicating the passage here — it will live
    // solely in `group.instructionMarkdown` instead. Until then this stays
    // untouched so nothing downstream needs to change yet.
    const fullQuestionMarkdown = passageText ? `${passageText}\n\n${questionMarkdown}` : questionMarkdown;

    return {
      questionNumber: block.questionNumber,
      subject: null,
      questionMarkdown: fullQuestionMarkdown,
      // NEW: the question's own text with no passage folded in, regardless
      // of whether one governs it — this is what the Question Group
      // upload path pastes into Question Text (the passage already lives
      // in group.instructionMarkdown and must not be duplicated a second
      // time). For an ungoverned question this is byte-identical to
      // questionMarkdown above (passageText is null either way); kept as
      // its own field anyway so callers don't have to re-derive that.
      questionOnlyMarkdown: questionMarkdown,
      type: "MCQ",
      options,
      correctAnswer,
      hasImage,
      imageMarkdown,
      // Question Group metadata — inert until the upload path consumes it
      // (see questionGroupsByQuestionIndex above). null for a question with
      // no governing passage; otherwise { id, instructionMarkdown,
      // questionNumbers, isFirstInGroup, isLastInGroup } describing the
      // shared Instruction/Title block this question belongs to on the
      // website. The paper's own question numbering is unaffected either
      // way — questionNumber above always stays the original, independent
      // number from the source document.
      group: groupByQuestionIndex.get(block.index) || null,
    };
  }

  function parseUpsc(rawMarkdown) {
    if (typeof rawMarkdown !== "string") {
      return [];
    }

    const questionBoundaries = findQuestionBoundaries(rawMarkdown);
    const assignments = computePassageAssignments(rawMarkdown, questionBoundaries);
    const passageByQuestionIndex = passageTextByQuestionIndex(assignments);
    const groupByQuestionIndex = questionGroupsByQuestionIndex(assignments);

    return splitIntoBlocks(rawMarkdown).map((block) => parseUpscBlock(block, passageByQuestionIndex, groupByQuestionIndex));
  }

  // --- NDA & NA Mathematics (separate internal execution path — does not
  // touch parse() or parseUpsc() above) ---

  // Reuses UPSC's own option/answer-key shapes directly rather than
  // duplicating them: verified structurally identical against both NDA
  // sample files — options are lowercase (a)-(d), and (like 2025 UPSC
  // papers) neither NDA sample carries an answer key at all, so
  // splitAtUpscAnswerMarker/resolveUpscCorrectAnswer safely no-op to
  // correctAnswer: null throughout, exactly as required. If a future NDA
  // paper ships with an answer key in a materially different shape, that's
  // the point to give NDA its own answer-marker pattern — not to alter
  // UPSC's.

  // A common-instruction line governing the next N questions. NDA's own
  // wording is NOT stable across papers — two count arrangements have been
  // observed in real sample files:
  //   - spelled-word-then-(digit): "Consider the following for the three
  //     (03) items that follow :" (2025 EN), "आने वाले तीन (03)
  //     प्रश्नांशों के लिए निम्नलिखित पर विचार कीजिए :" (2025 HI),
  //     "*Directions for the following three (03) items :*" (2019 EN)
  //   - digit-then-(spelled-word) — the UPSC-shaped arrangement instead:
  //     "आगे आने वाले 02 (दो) प्रश्नों के लिए निम्नलिखित पर विचार
  //     कीजिए :" (2019 HI)
  // The digit is always what's authoritative (it determines the group
  // size), so both arrangements are matched, never keyed on any spelled-out
  // English/Hindi count word. The marker line itself may also be wrapped in
  // Markdown emphasis (`*...*`, seen in 2019 EN only) — up to 2 leading
  // and/or trailing asterisks are tolerated around the line, so the line no
  // longer has to end in a bare colon, just a colon optionally followed by
  // emphasis-closing asterisks. Still anchored on a real parenthesized
  // count next to a colon-terminated line (not merely "any colon-terminated
  // line" or "any line with a number") — an ordinary question sentence like
  // "**110.** Consider the following discrete frequency distribution :"
  // (which has no parenthesized count at all) correctly does not match,
  // preserving the project's fail-closed intent. NDA has no separate
  // "Passage – N" label line at all; the shared stem text simply starts
  // right after this line (or lines — 2019 EN additionally carries a second,
  // marker-less boilerplate sentence before the real stem; since that line
  // has no parenthesized count either, it is never treated as a marker in
  // its own right and instead naturally falls into the stem text via the
  // existing "everything between the marker and the first governed
  // question" mechanism below — no 2019-specific handling needed for it).
  // Both count-arrangement branches require a real WHITESPACE gap
  // immediately before the parenthesized count (`\s+\(`, never `\(`
  // directly): a bare "N(" or "digit(" with no space is common ordinary
  // LaTeX (a coefficient touching a bracketed factor, e.g. "$4(x-p)(x-q)$",
  // or a function application, e.g. "$f(0) = 0$"), and such lines can
  // otherwise end in a colon too (a "Consider the following statements ...
  // :" per-question intro is a common, unrelated phrasing) — both real
  // collisions found in the 2019 English sample and excluded by this gap,
  // without needing to special-case either sentence. The leading
  // asterisk-tolerance below intentionally uses `[ \t]*`, not `\s*` (which
  // includes newlines and would let the match start from a preceding blank
  // line and swallow across the line boundary into unrelated content).
  // Verified against all four real NDA sample files (2025 EN/HI, 2019
  // EN/HI): exactly the expected marker count per file, zero false
  // positives elsewhere in any of them.
  const NDA_DIRECTIONS_MARKER_SOURCE =
    "^\\*{0,2}[ \\t]*.*?(?:\\s+\\((\\d+)\\)|(\\d+)\\s+\\([^)\\n\\d]*\\)).*?:[ \\t]*\\*{0,2}[ \\t]*$";

  function findNdaDirectionsMarkers(rawMarkdown) {
    const pattern = new RegExp(NDA_DIRECTIONS_MARKER_SOURCE, "gm");
    const markers = [];
    let match;

    while ((match = pattern.exec(rawMarkdown)) !== null) {
      markers.push({
        index: match.index,
        contentStart: match.index + match[0].length,
        itemCount: Number(match[1] !== undefined ? match[1] : match[2]),
      });
    }

    return markers;
  }

  // Unlike UPSC's computePassageAssignments, there is no separate passage
  // label to search for here — the "stem" governed questions share is
  // simply whatever text sits between the end of the directions line and
  // the start of the first governed question. This is genuinely simpler
  // than UPSC's nearest-preceding-passage-within-block logic, not a
  // reduced reimplementation of it: every NDA directions block seen governs
  // exactly one shared stem, never several. Produces {question, passage}
  // tuples in the exact shape passageTextByQuestionIndex and
  // questionGroupsByQuestionIndex (both defined above, for UPSC) already
  // consume, so both are reused here completely unchanged.
  function computeNdaAssignments(rawMarkdown, questionBoundaries) {
    const directionsMarkers = findNdaDirectionsMarkers(rawMarkdown);
    const assignments = [];

    directionsMarkers.forEach((marker, i) => {
      const blockEnd = i + 1 < directionsMarkers.length ? directionsMarkers[i + 1].index : Infinity;

      const governedQuestions = questionBoundaries
        .filter((boundary) => boundary.index > marker.index && boundary.index < blockEnd)
        .slice(0, marker.itemCount);

      if (governedQuestions.length === 0) {
        return;
      }

      const stemText = rawMarkdown.slice(marker.contentStart, governedQuestions[0].index).trim();
      const passage = { id: i, text: stemText };

      governedQuestions.forEach((question) => {
        assignments.push({ question, passage });
      });
    });

    return assignments;
  }

  // A question's own raw block can trail into the *next* question's
  // directions-line preamble, the same reason UPSC needs
  // truncateBeforeNextQuestionMetadata — but NDA has no separate passage
  // marker to union in, only its own directions line.
  const NDA_DIRECTIONS_PATTERN = new RegExp(NDA_DIRECTIONS_MARKER_SOURCE, "m");

  function truncateBeforeNextNdaDirectionsMarker(content) {
    const match = NDA_DIRECTIONS_PATTERN.exec(content);
    return match ? content.slice(0, match.index).trimEnd() : content;
  }

  function parseNdaBlock(block, stemByQuestionIndex, groupByQuestionIndex) {
    const ownContent = truncateBeforeNextNdaDirectionsMarker(block.content);
    const { beforeAnswer, answerText } = splitAtUpscAnswerMarker(ownContent);
    const { questionMarkdown, options } = splitUpscOptions(beforeAnswer);
    const { hasImage, imageMarkdown } = detectImage(block.rawBlock);
    const correctAnswer = resolveUpscCorrectAnswer(answerText);
    const stemText = stemByQuestionIndex.get(block.index) || null;
    // Same legacy/rollback rationale as UPSC's fullQuestionMarkdown: the
    // stem-duplicated form is always produced, even though the live
    // Question Group runtime pastes questionOnlyMarkdown for a grouped
    // question instead (see runPasteQuestion in
    // sites/modality/stateMachine.js) — kept so a revert to flattening
    // needs no parser change, only a runtime one.
    const fullQuestionMarkdown = stemText ? `${stemText}\n\n${questionMarkdown}` : questionMarkdown;

    return {
      questionNumber: block.questionNumber,
      subject: null,
      questionMarkdown: fullQuestionMarkdown,
      questionOnlyMarkdown: questionMarkdown,
      type: "MCQ",
      options,
      correctAnswer,
      hasImage,
      imageMarkdown,
      group: groupByQuestionIndex.get(block.index) || null,
    };
  }

  function parseNda(rawMarkdown) {
    if (typeof rawMarkdown !== "string") {
      return [];
    }

    const questionBoundaries = findQuestionBoundaries(rawMarkdown);
    const assignments = computeNdaAssignments(rawMarkdown, questionBoundaries);
    const stemByQuestionIndex = passageTextByQuestionIndex(assignments);
    const groupByQuestionIndex = questionGroupsByQuestionIndex(assignments);

    return splitIntoBlocks(rawMarkdown).map((block) => parseNdaBlock(block, stemByQuestionIndex, groupByQuestionIndex));
  }

  // --- NDA & NA General Ability Test (GAT) (separate internal execution
  // path — does not touch parse()/parseUpsc()/parseNda() above) ---

  // GAT's own Part heading, e.g. "## PART – A" / "## PART – B" (English) or
  // "## भाग – B" (Hindi). Matched structurally — any heading whose label is
  // a single whitespace-free token followed by a dash and a bare "A" or
  // "B" — rather than hardcoding "PART" or "भाग", the same tolerance
  // PASSAGE_MARKER_SOURCE already established for passage labels. This is
  // what lets one regex cover both languages' headings with no branch: the
  // English sample has both an "A" and a "B" marker, the Hindi sample (no
  // Part A at all) has only a "B" marker. Requires the "u" flag for
  // \p{Pd}, same as PASSAGE_MARKER_SOURCE.
  const GAT_PART_MARKER_SOURCE = "^#{1,6}\\s*\\S+\\s*\\p{Pd}\\s*([AB])\\s*$";

  // A "Directions : ..." line. Unlike UPSC's and NDA's own directions
  // markers, GAT's carries no parenthesized item count anywhere — verified
  // against the English sample: all 10 instances are a bare "Directions :"
  // followed by free-form instruction text, ending the line in either a
  // period or (once) a colon, never a digit count. Group 1 captures
  // everything after the "Directions :" label to end of line — this is
  // what lets computeGatAssignments use the marker's own text directly as
  // an instruction group's instructionMarkdown (see below) without a
  // second read of the source. Verified via grep against the English
  // sample: exactly 10 matches, zero elsewhere in the document (no
  // incidental "Directions" substring anywhere outside these 10 lines).
  // Verified against the Hindi sample: zero real matches — the only
  // substring hit for "निर्देश" is inside the unrelated word
  // "नामनिर्देशित" ("nominated"), not anchored at line start, which is
  // exactly why this pattern is anchored rather than a bare substring
  // search.
  // ASSUMPTION: each Directions instruction is entirely on one physical
  // line in the source markdown, as observed in both 2025 samples. A
  // future paper whose Directions text hard-wraps across multiple lines
  // before the first blank line would only have its first line captured
  // here, silently truncating the rest — not yet seen, so not handled.
  const GAT_DIRECTIONS_MARKER_SOURCE = "^Directions\\s*:\\s*(.*)$";

  function findGatPartMarkers(rawMarkdown) {
    const pattern = new RegExp(GAT_PART_MARKER_SOURCE, "gmu");
    const markers = [];
    let match;

    while ((match = pattern.exec(rawMarkdown)) !== null) {
      markers.push({ index: match.index, contentStart: match.index + match[0].length, letter: match[1] });
    }

    return markers;
  }

  function findGatDirectionsMarkers(rawMarkdown) {
    const pattern = new RegExp(GAT_DIRECTIONS_MARKER_SOURCE, "gm");
    const markers = [];
    let match;

    while ((match = pattern.exec(rawMarkdown)) !== null) {
      markers.push({
        index: match.index,
        contentStart: match.index + match[0].length,
        instructionText: match[1].trim(),
      });
    }

    return markers;
  }

  // GAT's directions blocks carry no declared item count (unlike UPSC and
  // NDA Mathematics), so a block's governed range is derived purely
  // structurally: every question between one Directions marker and the
  // next Directions marker, or the Part B boundary if this is the last
  // Directions marker in Part A — whichever comes first. This is also why
  // Directions markers are searched for only within the Part A span
  // (between the Part A and Part B headings): Part B never has any in
  // either sample, but scoping the search that way makes it structurally
  // impossible for a Part A block to consume a Part B question, rather
  // than relying only on the boundary math.
  //
  // Two distinct instructionMarkdown cases, distinguished purely by
  // whether real content sits between the marker and the first governed
  // question (see the shared "Passage groups vs GAT instruction groups"
  // design established for this feature):
  //   - non-empty gap  -> passage-style: that content becomes the shared
  //     instruction, the Directions sentence itself is discarded. Verified
  //     to apply only to Q1-5 in the English sample (a real passage
  //     paragraph sits between the marker and Q1).
  //   - empty gap      -> instruction-style: the marker's own captured
  //     text (Directions label already excluded) becomes the shared
  //     instruction instead, since there is nothing else to use. Verified
  //     to apply to the other 9 Part A blocks (Q6-8 through Q46-50) — each
  //     Directions line is immediately followed by its first governed
  //     question with only a blank line between them.
  // Produces {question, passage} tuples in the exact shape
  // passageTextByQuestionIndex and questionGroupsByQuestionIndex (both
  // defined above, for UPSC) already expect, so both are reused here
  // completely unchanged — the same reuse NDA Mathematics already
  // established.
  function computeGatAssignments(rawMarkdown, questionBoundaries) {
    const partMarkers = findGatPartMarkers(rawMarkdown);
    const partAMarker = partMarkers.find((marker) => marker.letter === "A");
    const partBMarker = partMarkers.find((marker) => marker.letter === "B");

    // No Part A heading at all (the Hindi sample: Part B only) -> there is
    // no Directions region to scan, so every question in the document is
    // standalone. This is the entire mechanism by which a Hindi-shaped GAT
    // document produces zero groups, with no language-specific code.
    if (!partAMarker) {
      return [];
    }

    const partAEnd = partBMarker ? partBMarker.index : rawMarkdown.length;
    const directionsMarkers = findGatDirectionsMarkers(rawMarkdown).filter(
      (marker) => marker.index > partAMarker.index && marker.index < partAEnd
    );
    const assignments = [];

    directionsMarkers.forEach((marker, i) => {
      const blockEnd = i + 1 < directionsMarkers.length ? directionsMarkers[i + 1].index : partAEnd;

      const governedQuestions = questionBoundaries.filter(
        (boundary) => boundary.index > marker.index && boundary.index < blockEnd
      );

      if (governedQuestions.length === 0) {
        return;
      }

      const gapText = rawMarkdown.slice(marker.contentStart, governedQuestions[0].index).trim();
      const instructionText = gapText.length > 0 ? gapText : marker.instructionText;
      const passage = { id: i, text: instructionText };

      governedQuestions.forEach((question) => {
        assignments.push({ question, passage });
      });
    });

    return assignments;
  }

  // A question's own raw block can trail into either the next Directions
  // line's preamble (the same reason UPSC/NDA need their own truncators)
  // OR, for Part A's very last governed question (Q50 in the English
  // sample), into the "## PART – B" heading itself and the blank lines
  // before it — splitIntoBlocks() bounds a block only by the next "**N.**"
  // question marker, which for Q50 is Q51's, so without this the Part B
  // heading text would otherwise be appended to Q50's own content. Unions
  // both marker shapes in one pattern, the same way UPSC's
  // PASSAGE_OR_DIRECTIONS_PATTERN unions two of its own; needs the "u" flag
  // for GAT_PART_MARKER_SOURCE's \p{Pd}. A no-op for every Part B question
  // in both samples, since neither marker shape occurs anywhere after the
  // Part B heading.
  const GAT_DIRECTIONS_OR_PART_PATTERN = new RegExp(`${GAT_DIRECTIONS_MARKER_SOURCE}|${GAT_PART_MARKER_SOURCE}`, "mu");

  function truncateBeforeNextGatBoundary(content) {
    const match = GAT_DIRECTIONS_OR_PART_PATTERN.exec(content);
    return match ? content.slice(0, match.index).trimEnd() : content;
  }

  // Three questions per language ("Match List I with List II...", English
  // Q62/81/84, Hindi Q12/31/34 — verified via grep, exactly 3 each) encode
  // their four options as a markdown table rather than plain "(a) ..."
  // lines: a header row "| | A | B | C | D |" (literal Latin letters, byte-
  // identical in both languages), then up to 4 data rows "| (a) | 1 | 4 |
  // 3 | 2 |" etc. splitUpscOptions() cannot parse this shape at all (its
  // marker requires a line starting with "(a)", not a table cell) and
  // would return options: null for these 3 questions per language if used
  // alone. The header row's literal "A | B | C | D" is the detection
  // signature — language-agnostic (doesn't hardcode "Code"/"कूट"), since
  // both languages render those column labels in Latin letters, verified
  // live against all 6 real occurrences.
  const GAT_MATCH_LIST_HEADER_SOURCE = "^\\|\\s*\\|\\s*A\\s*\\|\\s*B\\s*\\|\\s*C\\s*\\|\\s*D\\s*\\|\\s*$";
  const GAT_MATCH_LIST_ROW_SOURCE =
    "^\\|\\s*\\(([a-dA-D])\\)\\s*\\|\\s*([^|]+?)\\s*\\|\\s*([^|]+?)\\s*\\|\\s*([^|]+?)\\s*\\|\\s*([^|]+?)\\s*\\|\\s*$";
  const GAT_MATCH_LIST_COLUMN_LABELS = ["A", "B", "C", "D"];

  // Reconstructs each option letter's value from its own table row, zipped
  // against the header's A/B/C/D column labels, e.g. row "| (a) | 1 | 4 |
  // 3 | 2 |" becomes options.A = "A – 1, B – 4, C – 3, D – 2" — a faithful,
  // readable transcription of the row's own mapping, not an invented
  // value. Everything before the header row (including the question's own
  // "List I / List II" content table, which is part of its stem, not its
  // options, and needs no special handling) is returned as questionMarkdown,
  // the same responsibility splitUpscOptions() has for its own shape.
  // Returns null (not an empty options object) when the header signature
  // isn't found at all, so callers can fall back to the existing options:
  // null behavior exactly as before for any question that matches neither
  // shape.
  function parseGatMatchListOptions(beforeAnswer) {
    const headerPattern = new RegExp(GAT_MATCH_LIST_HEADER_SOURCE, "m");
    const headerMatch = headerPattern.exec(beforeAnswer);

    if (!headerMatch) {
      return null;
    }

    const rowPattern = new RegExp(GAT_MATCH_LIST_ROW_SOURCE, "gm");
    rowPattern.lastIndex = headerMatch.index + headerMatch[0].length;

    const options = { A: null, B: null, C: null, D: null };
    let rowsFound = 0;
    let match;

    while (rowsFound < 4 && (match = rowPattern.exec(beforeAnswer)) !== null) {
      const letter = match[1].toUpperCase();
      const values = [match[2].trim(), match[3].trim(), match[4].trim(), match[5].trim()];

      options[letter] = GAT_MATCH_LIST_COLUMN_LABELS.map((label, i) => `${label} – ${values[i]}`).join(", ");
      rowsFound += 1;
    }

    if (rowsFound === 0) {
      return null;
    }

    return { questionMarkdown: beforeAnswer.slice(0, headerMatch.index).trimEnd(), options };
  }

  // Tries the standard (a)-(d) line format first (unchanged, shared with
  // UPSC/NDA); only falls back to the GAT-specific table shape when that
  // finds nothing. splitUpscOptions() itself is never modified.
  function splitGatOptions(beforeAnswer) {
    const standard = splitUpscOptions(beforeAnswer);

    if (standard.options) {
      return standard;
    }

    const matchList = parseGatMatchListOptions(beforeAnswer);

    return matchList || standard;
  }

  // Reuses splitAtUpscAnswerMarker/resolveUpscCorrectAnswer completely
  // unchanged — GAT is expected to carry a real answer key for most years
  // (2011-2023); only the 2024/2025 samples are the known exception. If
  // the marker is present, it is parsed normally, exactly as it already is
  // for UPSC; if absent (as in both 2025 samples on hand), this safely
  // no-ops to correctAnswer: null, the same fail-closed behavior 2025 UPSC
  // and NDA Mathematics already rely on. No GAT-specific answer format is
  // introduced.
  function parseGatBlock(block, stemByQuestionIndex, groupByQuestionIndex) {
    const ownContent = truncateBeforeNextGatBoundary(block.content);
    const { beforeAnswer, answerText } = splitAtUpscAnswerMarker(ownContent);
    const { questionMarkdown, options } = splitGatOptions(beforeAnswer);
    const { hasImage, imageMarkdown } = detectImage(block.rawBlock);
    const correctAnswer = resolveUpscCorrectAnswer(answerText);
    const stemText = stemByQuestionIndex.get(block.index) || null;
    const fullQuestionMarkdown = stemText ? `${stemText}\n\n${questionMarkdown}` : questionMarkdown;

    return {
      questionNumber: block.questionNumber,
      subject: null,
      questionMarkdown: fullQuestionMarkdown,
      questionOnlyMarkdown: questionMarkdown,
      type: "MCQ",
      options,
      correctAnswer,
      hasImage,
      imageMarkdown,
      group: groupByQuestionIndex.get(block.index) || null,
    };
  }

  function parseGat(rawMarkdown) {
    if (typeof rawMarkdown !== "string") {
      return [];
    }

    const questionBoundaries = findQuestionBoundaries(rawMarkdown);
    const assignments = computeGatAssignments(rawMarkdown, questionBoundaries);
    const stemByQuestionIndex = passageTextByQuestionIndex(assignments);
    const groupByQuestionIndex = questionGroupsByQuestionIndex(assignments);

    return splitIntoBlocks(rawMarkdown).map((block) => parseGatBlock(block, stemByQuestionIndex, groupByQuestionIndex));
  }

  // --- CAT (separate internal execution path — does not touch
  // parse()/parseUpsc()/parseNda()/parseGat() above) ---

  // "## Section A: VARC — Verbal Ability and Reading Comprehension" /
  // "## Section B: DILR — ..." / "## Section C: QA — ...". Unlike GAT's
  // Part A/B marker (which matches its label structurally and never
  // hardcodes "PART"), the three CAT codes are hardcoded here deliberately
  // — VARC/DILR/QA are not merely structural placeholders, they ARE the
  // literal tag values `question.subject` needs downstream (see
  // findCatSubjectForIndex/ADD_TAGS), so capturing them directly is the
  // correct, minimal choice rather than a shortcut. Verified against the
  // approved sample: exactly 3 matches, one per section, in order.
  const CAT_SECTION_MARKER_SOURCE = "^#{1,6}\\s*Section\\s+[A-Za-z]:\\s*(VARC|DILR|QA)\\b";

  // "DIRECTIONS for the question 1: ..." / "DIRECTIONS for the questions 18:
  // ..." / "DIRECTIONS for questions 2-3: ..." / "DIRECTIONS for questions
  // 19 & 20: ...". Structurally similar to UPSC's/NDA's own directions
  // markers, but CAT's own dialect: literal "DIRECTIONS" in caps (not
  // "Directions"), and two distinct shapes for a single governed question
  // (singular or plural "question(s)", both with a leading "the") vs. a
  // range (plural "questions", no "the", separated by "-" or "&" — CAT 2025
  // Slot 3 uses both separators for genuine ranges, e.g. "19 & 20" and
  // "21 & 24"). Group 1 captures a lone question number, groups 2/3 capture
  // a range's start/end, group 4 captures the trailing instruction text
  // after the colon.
  //
  // PARSER PHILOSOPHY: the declared range captured by groups 1-3 IS the
  // group boundary — see computeCatAssignments. The transcription is a
  // deliberately normalized contract (SOURCE PDF -> transcription ->
  // Markdown contract -> this parser -> Docxsity); the contract's explicit
  // "questions N-M" is the source of truth, not a hint for the parser to
  // second-guess. A transcription whose declared range doesn't match the
  // paper's real structure is a transcription defect, fixed by correcting
  // the Markdown, never by teaching the parser to infer/extend/guess. The
  // "-" vs "&" range separator is still never captured as its own group —
  // it only ever matters for recognizing the marker at all, not for
  // interpreting the declared range differently by separator.
  const CAT_DIRECTIONS_MARKER_SOURCE =
    "^DIRECTIONS for (?:the questions? (\\d+)|questions (\\d+)\\s*(?:-|&)\\s*(\\d+)):\\s*(.*)$";

  // CAT's second, equally legitimate instruction-marker dialect —
  // "Instructions [1 - 4]" (CAT_2024_Slot_1.md, plain) / "**Instructions
  // [2 - 5]**" (CAT_2024_Slot_3.md, bold-wrapped). Semantically the exact
  // same construct as DIRECTIONS (see its own comment for the parser
  // philosophy both dialects now share equally) — it just uses a bracketed
  // numeric range instead of DIRECTIONS's colon-terminated free text, and
  // always carries its own instruction/passage prose on separate following
  // lines rather than trailing the marker itself (unlike DIRECTIONS, whose
  // group 4 sometimes carries real trailing text on the marker's own
  // line). Optional "**" wrapping is stripped by \*{0,2} on both ends,
  // matching plain and bold forms with one pattern. Groups 1/2 capture the
  // declared start/end — the group's actual boundary, same as DIRECTIONS's
  // groups 1-3. No same-line trailing-text group exists here (nothing has
  // ever been observed after the closing bracket/asterisks in this
  // corpus) — a hypothetical "Instructions [N-M] [FIGURE]" form is
  // intentionally left unsupported since it has no corpus evidence.
  const CAT_INSTRUCTIONS_MARKER_SOURCE = "^\\*{0,2}Instructions\\s*\\[\\s*(\\d+)\\s*-\\s*(\\d+)\\s*\\]\\*{0,2}\\s*$";

  // CAT's own bare option marker — either bare-digit ("1. ...", "2. ...",
  // "3. ...", "4. ...", as seen in CAT_2025_Slot_1/3) or bare-uppercase-
  // letter ("A. ...", "B. ...", "C. ...", "D. ...", as seen in
  // CAT_2024_Slot_2) — structurally distinct from JEE's parenthesized "(1)"
  // and UPSC's/NDA's/GAT's parenthesized lowercase "(a)". Group 1 captures
  // the digit shape, group 2 the letter shape; splitCatOptions normalizes
  // either into the same {A,B,C,D} options object. Only ever invoked (see
  // splitCatOptions below) for a question already determined to be MCQ —
  // never run against TITA content, since several genuine TITA questions
  // (Q4, Q5, Q15, Q16 in the approved sample; also Q2/Q12 in
  // CAT_2024_Slot_2) embed their own bare-numbered list as part of the
  // question body (a jumbled-sentence / sequencing puzzle), which is
  // structurally indistinguishable from a real options list by this regex
  // alone. Type is decided from the explicit [TITA] marker (see
  // CAT_TITA_TAG_PATTERN) before this is ever reached.
  //
  // CRITICAL: this regex is intentionally CAT-only, never promoted to a
  // shared/generic option detector. jee-main-pyq.md's own Q33 proves why —
  // it embeds five bare "A./B./C./D./E." labelled statements as ordinary
  // question-body content, with the real answer options given separately
  // in JEE's own "(1)/(2)/(3)/(4)" format. A generic "^[A-D]\\." detector
  // applied across exams would misparse that question; scoping the letter
  // shape to CAT_OPTION_MARKER_SOURCE (used only inside splitCatOptions,
  // only after a question is already known to be CAT and non-TITA) avoids
  // that entirely, the same way JEE's own OPTION_MARKER_SOURCE and UPSC's
  // own UPSC_OPTION_MARKER_SOURCE already coexist as separate constants.
  const CAT_OPTION_MARKER_SOURCE = "^(?:([1-4])|([A-D]))\\.\\s*";

  // The explicit, authoritative CAT question-type marker, normalized into
  // the sample immediately after the question's own "**N.**" marker (see
  // samples/CAT_2025_Slot_1.md) — e.g. "**52.** [TITA] What is ...". Never
  // inferred from the answer line (which, post-normalization, carries no
  // "(TITA)" suffix at all) and never inferred from option presence/absence
  // — both of those signals are exactly what the embedded-numbered-list
  // false positive (Q4/Q5/Q15/Q16) would defeat. Matched at the very start
  // of a question's own content (immediately after splitIntoBlocks() has
  // already stripped the "**N.**" marker itself), so this is the very first
  // thing parseCatBlock inspects, before any option or answer parsing.
  const CAT_TITA_TAG_PATTERN = /^\[TITA\]\s*/;

  function findCatSectionMarkers(rawMarkdown) {
    const pattern = new RegExp(CAT_SECTION_MARKER_SOURCE, "gm");
    const markers = [];
    let match;

    while ((match = pattern.exec(rawMarkdown)) !== null) {
      markers.push({ index: match.index, code: match[1] });
    }

    return markers;
  }

  // Nearest-preceding-marker lookup, the same shape findSectionLetterForIndex
  // (JEE, near the top of this file) and findSubjectForIndex already use —
  // a section remains active until the next CAT Section marker or EOF.
  function findCatSubjectForIndex(sectionMarkers, index) {
    let current = null;

    for (const marker of sectionMarkers) {
      if (marker.index > index) {
        break;
      }
      current = marker;
    }

    return current ? current.code : null;
  }

  // Finds both CAT instruction-marker dialects (DIRECTIONS and Instructions)
  // and merges them into one list, sorted back into document order. Both
  // dialects carry `declaredStart`/`declaredEnd` — the explicit question
  // range the transcription itself declares, which computeCatAssignments
  // now treats as authoritative for both (see its own comment). An
  // Instructions match never has same-line trailing text (see
  // CAT_INSTRUCTIONS_MARKER_SOURCE's comment), so its instructionText is
  // always "" — computeCatAssignments's existing empty-gap fallback
  // already handles that correctly with no changes needed there.
  function findCatDirectionsMarkers(rawMarkdown) {
    const markers = [];

    const directionsPattern = new RegExp(CAT_DIRECTIONS_MARKER_SOURCE, "gm");
    let match;
    while ((match = directionsPattern.exec(rawMarkdown)) !== null) {
      markers.push({
        index: match.index,
        contentStart: match.index + match[0].length,
        instructionText: match[4] !== undefined ? match[4].trim() : "",
        declaredStart: match[1] ? Number(match[1]) : Number(match[2]),
        declaredEnd: match[1] ? Number(match[1]) : Number(match[3]),
      });
    }

    const instructionsPattern = new RegExp(CAT_INSTRUCTIONS_MARKER_SOURCE, "gm");
    while ((match = instructionsPattern.exec(rawMarkdown)) !== null) {
      markers.push({
        index: match.index,
        contentStart: match.index + match[0].length,
        instructionText: "",
        declaredStart: Number(match[1]),
        declaredEnd: Number(match[2]),
      });
    }

    markers.sort((a, b) => a.index - b.index);

    return markers;
  }

  // Group-boundary computation. PARSER PHILOSOPHY: the transcription's own
  // declared question range — "DIRECTIONS for questions N-M" or
  // "Instructions [N-M]" — IS the group boundary. Both dialects are
  // treated identically and literally: a marker governs exactly its
  // declared [declaredStart, declaredEnd] question numbers, clipped only
  // by the ordinary structural bounds every CAT group already respects
  // (never past the next marker, the next Section, or EOF — this is a
  // safety clamp against a malformed/overlapping transcription, not an
  // inference step). Nothing here inspects question content, prose
  // structure, option formatting, or answer text to decide membership,
  // and nothing here is specific to any paper, year, slot, or question
  // number — it is a literal reading of what the Markdown contract states.
  //
  // If a real transcription's declared range doesn't match the paper's
  // actual structure (an undercount, an overcount, or any other
  // discrepancy), that is a transcription defect to fix in the Markdown
  // itself — never something this parser attempts to detect, infer, or
  // silently compensate for. See the CAT-wide reconnaissance for the
  // specific cases in the current corpus needing a transcription fix,
  // reported separately rather than papered over here.
  //
  // Instruction-content preservation: CAT's own marker grammar allows real
  // instruction/passage text in TWO places — trailing the marker itself
  // ("DIRECTIONS for questions N-M: <text>") and/or in the gap between the
  // marker line and the first governed question. Both are genuine
  // transcription content; neither is assumed to be disposable boilerplate
  // versus the "real" passage — the parser does not interpret what either
  // piece says, only whether it's present. So both are kept, concatenated
  // in document order (marker-line text always precedes gap text, since
  // that's their order in the source) and never duplicated: whichever of
  // the two is empty simply contributes nothing to the join. This is a
  // deliberate departure from CAT's/GAT's/NDA Mathematics's older
  // either-or instruction split (still used by those other exam parsers,
  // unchanged) — CAT is the only dialect whose own marker line has been
  // observed carrying substantive, non-boilerplate content of its own
  // (e.g. CAT_2024_Slot_3.md's "DIRECTIONS for questions 25-29: The figure
  // below shows a network..." — a full scene-setting paragraph, not a
  // generic "the passage below..." sentence), so silently preferring one
  // source over the other is never safe here. Produces {question, passage}
  // tuples in the exact shape questionGroupsByQuestionIndex (defined
  // above, for UPSC) already expects.
  function computeCatAssignments(rawMarkdown, questionBoundaries) {
    const directionsMarkers = findCatDirectionsMarkers(rawMarkdown);
    const sectionMarkers = findCatSectionMarkers(rawMarkdown);
    const assignments = [];

    directionsMarkers.forEach((marker, i) => {
      const nextDirectionsIndex = i + 1 < directionsMarkers.length ? directionsMarkers[i + 1].index : Infinity;
      const nextSection = sectionMarkers.find((section) => section.index > marker.index);
      const nextSectionIndex = nextSection ? nextSection.index : Infinity;
      const blockEnd = Math.min(nextDirectionsIndex, nextSectionIndex);

      const governedQuestions = questionBoundaries.filter(
        (boundary) =>
          boundary.index > marker.index &&
          boundary.index < blockEnd &&
          boundary.questionNumber >= marker.declaredStart &&
          boundary.questionNumber <= marker.declaredEnd
      );

      if (governedQuestions.length === 0) {
        return;
      }

      const gapText = rawMarkdown.slice(marker.contentStart, governedQuestions[0].index).trim();
      // Concatenate marker-line text and gap text, in that document order,
      // skipping whichever side is empty — see the comment above this
      // function. Applies uniformly to both marker dialects; nothing here
      // is keyed to either literal marker keyword or to any specific
      // content (e.g. "[FIGURE]") on either side.
      const instructionText = [marker.instructionText, gapText].filter((text) => text.length > 0).join("\n\n");
      const passage = { id: i, text: instructionText };

      governedQuestions.forEach((question) => {
        assignments.push({ question, passage });
      });
    });

    return assignments;
  }

  // A question's own raw block can trail into the next DIRECTIONS/
  // Instructions line's preamble or the next Section heading — the same
  // reason every other exam in this file needs its own truncator. Unions
  // all three CAT marker shapes in one pattern, the same way GAT's own
  // truncateBeforeNextGatBoundary unions its Directions and Part markers.
  const CAT_BOUNDARY_PATTERN = new RegExp(
    `${CAT_DIRECTIONS_MARKER_SOURCE}|${CAT_INSTRUCTIONS_MARKER_SOURCE}|${CAT_SECTION_MARKER_SOURCE}`,
    "m"
  );

  function truncateBeforeNextCatBoundary(content) {
    const match = CAT_BOUNDARY_PATTERN.exec(content);
    return match ? content.slice(0, match.index).trimEnd() : content;
  }

  // Only ever called once a question has already been determined to be MCQ
  // (see parseCatBlock) — never against TITA content. Structurally the same
  // composition as splitOptions/splitUpscOptions, just with
  // CAT_OPTION_MARKER_SOURCE's bare-digit-or-letter shape. Both shapes
  // normalize into the same {A,B,C,D} options object: a digit match goes
  // through the existing DIGIT_TO_LETTER map (already defined above, for
  // JEE, reused unchanged); a letter match is already the target key and is
  // used as-is. The two shapes are never mixed within a single call — each
  // CAT paper uses one consistently — but nothing here assumes that; each
  // option marker is normalized independently.
  function splitCatOptions(beforeAnswer) {
    const pattern = new RegExp(CAT_OPTION_MARKER_SOURCE, "gm");
    const matches = [];
    let match;

    while ((match = pattern.exec(beforeAnswer)) !== null) {
      matches.push({
        digit: match[1],
        letter: match[2],
        index: match.index,
        contentStart: match.index + match[0].length,
      });
    }

    if (matches.length === 0) {
      return { questionMarkdown: beforeAnswer.trimEnd(), options: null };
    }

    const questionMarkdown = beforeAnswer.slice(0, matches[0].index).trimEnd();
    const options = { A: null, B: null, C: null, D: null };

    matches.forEach((optionMatch, i) => {
      const optionEnd = i + 1 < matches.length ? matches[i + 1].index : beforeAnswer.length;
      const letter = optionMatch.letter || DIGIT_TO_LETTER[optionMatch.digit];
      options[letter] = beforeAnswer.slice(optionMatch.contentStart, optionEnd).trimEnd();
    });

    return { questionMarkdown, options };
  }

  // CAT's own answer-key resolution — mirrors resolveUpscCorrectAnswer's
  // shape (a small, exam-owned normalizer, never a shared function) but for
  // CAT's own bare-value "**Ans.** N" / "**Ans.** X" convention rather than
  // UPSC's parenthesized "(a)". Accepts either a bare digit 1-4 (via the
  // existing DIGIT_TO_LETTER map, reused unchanged) or a bare uppercase
  // letter A-D (already the canonical key, used as-is) — the same two
  // shapes CAT_OPTION_MARKER_SOURCE/splitCatOptions now recognize for
  // options themselves, kept in sync deliberately. Anything else (a dropped
  // question, stray text) resolves to null, identical to the prior digit-
  // only behavior.
  const CAT_ANSWER_LETTER_PATTERN = /^[A-D]$/;

  function resolveCatCorrectAnswer(answerText) {
    if (!answerText) {
      return null;
    }

    if (DIGIT_TO_LETTER[answerText]) {
      return DIGIT_TO_LETTER[answerText];
    }

    if (CAT_ANSWER_LETTER_PATTERN.test(answerText)) {
      return answerText;
    }

    return null;
  }

  // The critical ordering this whole feature depends on: type is decided
  // FIRST, from the explicit [TITA] marker alone, before anything else
  // touches the question's own content — never from the answer line (which
  // carries no signal post-normalization) and never from whether an
  // options-shaped list happens to be present (which several genuine TITA
  // questions have, as their own body content, not as real options). Only
  // once type is known does the function decide whether option-splitting
  // ever runs at all.
  //
  // [FIGURE] is deliberately left untouched everywhere in this function —
  // it is operator-facing source content (a marker in the user's own
  // Markdown-conversion workflow telling them to manually insert a
  // chart/image on Docxsity), not an extension capability. detectImage()
  // is reused completely unchanged and is not expected to (and does not)
  // recognize it; this is intentional, not an oversight.
  function parseCatBlock(block, sectionMarkers, groupByQuestionIndex) {
    const titaMatch = block.content.match(CAT_TITA_TAG_PATTERN);
    const isTita = titaMatch !== null;
    const ownContentRaw = isTita ? block.content.slice(titaMatch[0].length) : block.content;
    const ownContent = truncateBeforeNextCatBoundary(ownContentRaw);
    const { beforeAnswer, answerText } = splitAtUpscAnswerMarker(ownContent);

    let questionMarkdown;
    let options;
    let correctAnswer;

    if (isTita) {
      questionMarkdown = beforeAnswer.trimEnd();
      options = null;
      // Preserved as the raw numeric string exactly as it appears on the
      // Ans. line (e.g. "50", "3421", "0") — never resolved to a letter,
      // never touched by DIGIT_TO_LETTER. Docxsity's "Answers for Blanks"
      // field is not automated by this feature (see runMarkCorrect's
      // existing NUMERICAL skip in sites/docxsity/stateMachine.js); this
      // value is stored for a future or manual step only.
      correctAnswer = answerText;
    } else {
      const split = splitCatOptions(beforeAnswer);
      questionMarkdown = split.questionMarkdown;
      options = split.options;
      correctAnswer = resolveCatCorrectAnswer(answerText);
    }

    const { hasImage, imageMarkdown } = detectImage(block.rawBlock);
    const subject = findCatSubjectForIndex(sectionMarkers, block.index);
    const group = groupByQuestionIndex.get(block.index) || null;
    // Legacy/rollback field, same convention as UPSC/NDA/GAT's own
    // fullQuestionMarkdown: folds the shared instruction in directly from
    // group.instructionMarkdown (rather than a separate
    // passageTextByQuestionIndex lookup — the two would be byte-identical
    // for a grouped question, so this avoids the redundant map) even
    // though the live Question Group runtime pastes questionOnlyMarkdown
    // instead for a grouped question.
    const fullQuestionMarkdown = group ? `${group.instructionMarkdown}\n\n${questionMarkdown}` : questionMarkdown;

    return {
      questionNumber: block.questionNumber,
      subject,
      questionMarkdown: fullQuestionMarkdown,
      questionOnlyMarkdown: questionMarkdown,
      type: isTita ? "NUMERICAL" : "MCQ",
      options,
      correctAnswer,
      hasImage,
      imageMarkdown,
      group,
    };
  }

  function parseCat(rawMarkdown) {
    if (typeof rawMarkdown !== "string") {
      return [];
    }

    const questionBoundaries = findQuestionBoundaries(rawMarkdown);
    const sectionMarkers = findCatSectionMarkers(rawMarkdown);
    const assignments = computeCatAssignments(rawMarkdown, questionBoundaries);
    const groupByQuestionIndex = questionGroupsByQuestionIndex(assignments);

    return splitIntoBlocks(rawMarkdown).map((block) => parseCatBlock(block, sectionMarkers, groupByQuestionIndex));
  }

  // Single entry point the panel uses going forward: detects which exam the
  // loaded file belongs to, then routes to that exam's own parser. JEE's own
  // `parse` above is unchanged and still exported directly for anything that
  // depends on today's behavior.
  function parseDocument(rawMarkdown) {
    const examType = detectExamType(rawMarkdown);

    if (examType === "JEE") {
      return { examType, questions: parse(rawMarkdown) };
    }

    if (examType === "UPSC_PAPER_I" || examType === "UPSC_PAPER_II") {
      return { examType, questions: parseUpsc(rawMarkdown) };
    }

    if (examType === "NDA_MATHEMATICS") {
      return { examType, questions: parseNda(rawMarkdown) };
    }

    if (examType === "NDA_GAT") {
      return { examType, questions: parseGat(rawMarkdown) };
    }

    if (examType === "CAT") {
      return { examType, questions: parseCat(rawMarkdown) };
    }

    return { examType: null, questions: [] };
  }

  window.ExamUploadAssistantParser = { parse, parseUpsc, parseNda, parseGat, parseCat, detectExamType, parseDocument };
})();
