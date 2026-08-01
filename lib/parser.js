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

  const UPSC_OPTION_MARKER_SOURCE = "^\\(([a-d])\\)\\s*";
  const LOWERCASE_TO_LETTER = { a: "A", b: "B", c: "C", d: "D" };
  // Both languages render the paper number as a Latin-script Roman numeral
  // ("Paper I" / "Paper II") even in the Hindi title, so this needs no
  // per-language variant. "II" is checked before "I" so "Paper II" is never
  // mistaken for "Paper I" (a bare word-boundary check on "I" alone would
  // still fail correctly here, since the character after that "I" in
  // "Paper II" is another word character and breaks the \b — but matching
  // "II" first keeps the intent explicit).
  const PAPER_NUMBER_PATTERN = /Paper\s+(II|I)\b/i;
  // A standalone line naming a passage: e.g. "Passage – 1" (English) or
  // "परिच्छेद – 1" (Hindi). The word itself differs by language, but the
  // shape — one word, an en dash, a number, nothing else on the line — is
  // identical in both, so this is matched structurally rather than by
  // hardcoding either language's word. Verified against all four sample
  // papers: zero false positives in the (passage-free) Paper I samples.
  const PASSAGE_MARKER_SOURCE = "^\\s*\\S+\\s*[–-]\\s*(\\d+)\\s*$";
  // A "Directions for the following N (word) items :" line (English) or its
  // Hindi equivalent: a number immediately followed by a parenthesized word,
  // with the line ending in a colon. Same reasoning as above — matched by
  // shape, not by language-specific wording. This line declares how many of
  // the immediately following questions are governed by the passage(s) that
  // follow it.
  const DIRECTIONS_MARKER_SOURCE = "^.*?(\\d+)\\s*\\([^)\\n]*\\)[^:\\n]*:\\s*$";

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
    const pattern = new RegExp(PASSAGE_MARKER_SOURCE, "gm");
    const markers = [];
    let match;

    while ((match = pattern.exec(rawMarkdown)) !== null) {
      markers.push({ index: match.index, contentStart: match.index + match[0].length });
    }

    return markers;
  }

  // Every parsed UPSC question must be self-contained, so a passage shared
  // by several questions is duplicated into each one rather than referenced.
  // The "Directions for the following N items" line is what bounds how many
  // of the following questions a passage governs — without it, there is no
  // way to tell a passage-governed question apart from a plain question
  // that merely happens to follow a passage elsewhere in the paper.
  function computePassageByQuestionIndex(rawMarkdown, questionBoundaries) {
    const directionsMarkers = findDirectionsMarkers(rawMarkdown);
    const rawPassageMarkers = findPassageMarkers(rawMarkdown);

    const passages = rawPassageMarkers.map((marker, i) => {
      const nextPassageIndex = i + 1 < rawPassageMarkers.length ? rawPassageMarkers[i + 1].index : Infinity;
      const nextQuestionBoundary = questionBoundaries.find((boundary) => boundary.index > marker.index);
      const nextQuestionIndex = nextQuestionBoundary ? nextQuestionBoundary.index : Infinity;
      const end = Math.min(nextPassageIndex, nextQuestionIndex);

      return {
        index: marker.index,
        text: rawMarkdown.slice(marker.contentStart, end).trim(),
      };
    });

    const passageByQuestionIndex = new Map();

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
          passageByQuestionIndex.set(question.index, passage.text);
        }
      });
    });

    return passageByQuestionIndex;
  }

  // A question's own raw block (bounded only by the next "**N.**" marker)
  // can trail into the *next* question's "Directions.../Passage – N"
  // preamble, since those marker lines sit between one question's last
  // option and the next question marker, not between two question
  // boundaries of their own. That trailing preamble belongs to the
  // following question (as its passage), never to this one's last option —
  // so it must be cut off before options are split out.
  const PASSAGE_OR_DIRECTIONS_PATTERN = new RegExp(`${DIRECTIONS_MARKER_SOURCE}|${PASSAGE_MARKER_SOURCE}`, "m");

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

  function resolveUpscCorrectAnswer(answerValue) {
    if (answerValue === null) {
      return null;
    }

    const normalized = answerValue.trim().toLowerCase();

    if (LOWERCASE_TO_LETTER[normalized]) {
      return LOWERCASE_TO_LETTER[normalized];
    }

    return answerValue.trim();
  }

  function parseUpscBlock(block, passageByQuestionIndex) {
    const ownContent = truncateBeforeNextQuestionMetadata(block.content);
    const { beforeAnswer, answerValue } = splitAtAnswerMarker(ownContent);
    const { questionMarkdown, options } = splitUpscOptions(beforeAnswer);
    const { hasImage, imageMarkdown } = detectImage(block.rawBlock);
    const correctAnswer = resolveUpscCorrectAnswer(answerValue);
    const passageText = passageByQuestionIndex.get(block.index) || null;
    const fullQuestionMarkdown = passageText ? `${passageText}\n\n${questionMarkdown}` : questionMarkdown;

    return {
      questionNumber: block.questionNumber,
      subject: null,
      questionMarkdown: fullQuestionMarkdown,
      type: "MCQ",
      options,
      correctAnswer,
      hasImage,
      imageMarkdown,
    };
  }

  function parseUpsc(rawMarkdown) {
    if (typeof rawMarkdown !== "string") {
      return [];
    }

    const questionBoundaries = findQuestionBoundaries(rawMarkdown);
    const passageByQuestionIndex = computePassageByQuestionIndex(rawMarkdown, questionBoundaries);

    return splitIntoBlocks(rawMarkdown).map((block) => parseUpscBlock(block, passageByQuestionIndex));
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
