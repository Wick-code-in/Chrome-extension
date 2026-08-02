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

  // INTENTIONAL: an unrecognized title (neither "JEE" nor "UPSC"/"Civil
  // Services", or a UPSC title without a matching Paper I/II) falls through
  // to `null` here on purpose — parseDocument then returns zero questions
  // rather than guessing which exam's rules to apply to unrecognized
  // content. This is a deliberate fail-closed default, not a gap to patch.
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

    return { examType: null, questions: [] };
  }

  window.ExamUploadAssistantParser = { parse, parseUpsc, detectExamType, parseDocument };
})();
