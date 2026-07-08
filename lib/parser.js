(function () {
  const QUESTION_MARKER_SOURCE = "^\\*\\*(\\d+)\\.\\*\\*\\s*";
  const OPTION_MARKER_SOURCE = "^\\(([1-4])\\)\\s*";
  const ANSWER_MARKER_SOURCE = "^Ans\\.\\s*\\(([^)]*)\\)";
  const DIGIT_TO_LETTER = { 1: "A", 2: "B", 3: "C", 4: "D" };
  const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\([^)]*\)/;
  const HTML_IMAGE_PATTERN = /<img\b[^>]*>/i;

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
        rawBlock: rawMarkdown.slice(boundary.index, blockEnd),
        content: rawMarkdown.slice(boundary.contentStart, blockEnd),
      };
    });
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

  function determineType(options) {
    if (options && options.A && options.B && options.C && options.D) {
      return "MCQ";
    }

    return "UNKNOWN";
  }

  function parseBlock(block) {
    const { beforeAnswer, answerValue } = splitAtAnswerMarker(block.content);
    const { questionMarkdown, options } = splitOptions(beforeAnswer);
    const { hasImage, imageMarkdown } = detectImage(block.rawBlock);
    const type = determineType(options);
    const correctAnswer = resolveCorrectAnswer(answerValue, options);

    return {
      questionNumber: block.questionNumber,
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

    return splitIntoBlocks(rawMarkdown).map(parseBlock);
  }

  window.ExamUploadAssistantParser = { parse };
})();
