(function () {
  const Session = window.ExamUploadAssistantSession;
  const DomHelpers = window.ExamUploadAssistantDomHelpers;
  const Selectors = window.ExamUploadAssistantSelectors;

  const PREPARE_FORM_MARKS_VALUE = "4";
  const PREPARE_FORM_PENALTY_VALUE = "1";
  const OPTION_LETTERS = ["A", "B", "C", "D"];
  const POSITIVE_INTEGER_PATTERN = /^\d+$/;

  // UPSC marks/penalty, per paper — JEE keeps using the constants above
  // (this map simply isn't consulted for examType "JEE").
  // HARDCODED: these reflect UPSC's current, known marking scheme (as of
  // the 2023/2025 papers studied) — they are fixed values, not derived from
  // the source markdown, since the papers themselves never state their own
  // marks/negative-marking ratio. If UPSC changes this scheme in a future
  // cycle, these two lines are the only place that needs updating, but
  // nothing in the parser or the markdown would signal that a change has
  // happened — this would need to be caught manually.
  const MARKS_PENALTY_BY_UPSC_PAPER = {
    UPSC_PAPER_I: { marks: "2", penalty: "0.66" },
    UPSC_PAPER_II: { marks: "2.5", penalty: "0.83" },
  };

  function isUpscExamType(examType) {
    return examType === "UPSC_PAPER_I" || examType === "UPSC_PAPER_II";
  }

  const NEXT_STATE = {
    IDLE: "PREPARE_FORM",
    PREPARE_FORM: "PASTE_QUESTION",
    PASTE_QUESTION: "PASTE_OPTIONS",
    PASTE_OPTIONS: "MARK_CORRECT",
    MARK_CORRECT: "GENERATE_AI",
    GENERATE_AI: "ADD_TAGS",
    ADD_TAGS: "SAVE",
    SAVE: "NEXT_QUESTION",
  };

  function logTransition(state, result) {
    console.log("[Exam Upload Assistant]", state, "->", result);
  }

  // Single source of truth for operator-facing success wording. The panel
  // reports the extension's current workflow state, not how that state was
  // reached — so Pass Step looks up the same message Execute Step would show
  // for the same state, rather than describing the fact that it was skipped.
  function getStateSuccessMessage(state) {
    switch (state) {
      case "IDLE":
        return "Ready to begin.";
      case "PREPARE_FORM":
        return "Question prepared.";
      case "PASTE_QUESTION":
        return "Question pasted.";
      case "PASTE_OPTIONS":
        return "Options pasted.";
      case "MARK_CORRECT":
        return "Correct answer selected.";
      case "GENERATE_AI":
        return "Generate with AI clicked.";
      case "ADD_TAGS":
        return "Tag added.";
      case "SAVE":
        return "Save clicked.";
      case "NEXT_QUESTION":
        return Session.hasCurrentQuestion() ? "Moved to next question." : "Upload complete.";
      case "COMPLETE":
        return "Upload complete.";
      default:
        return "";
    }
  }

  function runIdle() {
    if (!Session.hasCurrentQuestion()) {
      return {
        success: false,
        message: "No questions loaded. Load and parse a Markdown file first.",
        retryable: true,
      };
    }

    return {
      success: true,
      message: getStateSuccessMessage("IDLE"),
      retryable: false,
    };
  }

  async function runPrepareForm() {
    if (!Session.hasCurrentQuestion()) {
      return {
        success: false,
        message: "No current question to prepare.",
        retryable: false,
      };
    }

    const question = Session.getCurrentQuestion();

    if (question.hasImage) {
      return {
        success: false,
        message:
          "This question contains an image. Insert it manually on the target website, then click Execute Step to continue.",
        retryable: true,
      };
    }

    const selectors = Selectors.prepareForm;

    let questionTypeValue;

    if (question.type === "MCQ") {
      questionTypeValue = selectors.mcqOptionValue;
    } else if (question.type === "NUMERICAL") {
      questionTypeValue = selectors.fillBlankOptionValue;
    } else {
      return {
        success: false,
        message:
          "This question's type could not be determined from its section markers. Fix the source markdown and reload, then Jump back to this question.",
        retryable: true,
      };
    }

    const clickResult = DomHelpers.clickElement(selectors.addQuestionButton);
    if (!clickResult.success) {
      return clickResult;
    }

    // The Marks field's own presence is the readiness signal for the whole
    // form — it's one of the fields we need anyway, so there's no separate
    // dialog/wrapper selector to maintain.
    const waitResult = await DomHelpers.waitForElement(selectors.marksInput);
    if (!waitResult.success) {
      return waitResult;
    }

    const typeResult = DomHelpers.selectDropdown(selectors.questionTypeDropdown, questionTypeValue);
    if (!typeResult.success) {
      return typeResult;
    }

    const upscMarksPenalty = MARKS_PENALTY_BY_UPSC_PAPER[Session.getExamType()];
    const marksValue = upscMarksPenalty ? upscMarksPenalty.marks : PREPARE_FORM_MARKS_VALUE;
    const penaltyValue = upscMarksPenalty ? upscMarksPenalty.penalty : PREPARE_FORM_PENALTY_VALUE;

    const marksResult = DomHelpers.fillInput(selectors.marksInput, marksValue);
    if (!marksResult.success) {
      return marksResult;
    }

    if (question.type === "MCQ") {
      const penaltyResult = DomHelpers.fillInput(selectors.penaltyInput, penaltyValue);
      if (!penaltyResult.success) {
        return penaltyResult;
      }
    }

    return {
      success: true,
      message: getStateSuccessMessage("PREPARE_FORM"),
      retryable: false,
      focusTarget: selectors.questionTypeDropdown,
    };
  }

  async function runPasteQuestion() {
    if (!Session.hasCurrentQuestion()) {
      return {
        success: false,
        message: "No current question to paste.",
        retryable: false,
      };
    }

    const question = Session.getCurrentQuestion();
    const questionMarkdown = question.questionMarkdown;

    if (!questionMarkdown) {
      return {
        success: false,
        message: "This question has no question text to paste.",
        retryable: false,
      };
    }

    const modalSelectors = Selectors.markdownImportModal;

    const pasteResult = await DomHelpers.pasteMarkdown(
      {
        triggerButton: Selectors.pasteQuestion.markdownButton,
        modal: modalSelectors.container,
        textarea: modalSelectors.rawMarkdownTextarea,
        confirmButton: modalSelectors.renderAndInsertButton,
      },
      questionMarkdown
    );

    if (!pasteResult.success) {
      return pasteResult;
    }

    return {
      success: true,
      message: getStateSuccessMessage("PASTE_QUESTION"),
      retryable: false,
      focusTarget: Selectors.pasteQuestion.markdownButton,
    };
  }

  async function runPasteOptions() {
    if (!Session.hasCurrentQuestion()) {
      return {
        success: false,
        message: "No current question to paste options for.",
        retryable: false,
      };
    }

    const question = Session.getCurrentQuestion();

    if (!question.options) {
      return {
        success: false,
        message: "This question has no options to paste.",
        retryable: false,
      };
    }

    const modalSelectors = Selectors.markdownImportModal;

    for (const letter of OPTION_LETTERS) {
      const optionText = question.options[letter];

      if (!optionText) {
        return {
          success: false,
          message: `Option ${letter} has no text to paste.`,
          retryable: false,
        };
      }

      const pasteResult = await DomHelpers.pasteMarkdown(
        {
          triggerButton: Selectors.pasteOptions.markdownButton(letter),
          modal: modalSelectors.container,
          textarea: modalSelectors.rawMarkdownTextarea,
          confirmButton: modalSelectors.renderAndInsertButton,
        },
        optionText
      );

      if (!pasteResult.success) {
        return pasteResult;
      }
    }

    return {
      success: true,
      message: getStateSuccessMessage("PASTE_OPTIONS"),
      retryable: false,
      focusTarget: Selectors.pasteOptions.markdownButton("A"),
    };
  }

  function runMarkCorrect() {
    if (!Session.hasCurrentQuestion()) {
      return {
        success: false,
        message: "No current question to mark correct.",
        retryable: false,
      };
    }

    const question = Session.getCurrentQuestion();

    if (!question.correctAnswer) {
      // UPSC papers from 2024–2025 are released without an official answer
      // key (verified against the sample papers — earlier years do carry
      // one and are handled by the branch below like any other exam). This
      // is expected, not an error: mirror exactly how runPasteOptions stops
      // for a question with no options to paste, and wait for the operator
      // to mark the answer manually and use Pass Step.
      const message = isUpscExamType(Session.getExamType())
        ? "This paper does not contain an answer key for this question. Mark the correct option manually on the target website, then use Pass Step to continue."
        : "This question has no correct answer to select.";

      return {
        success: false,
        message,
        retryable: false,
      };
    }

    const value = Selectors.correctAnswerValueByLetter[question.correctAnswer];

    if (value === undefined) {
      return {
        success: false,
        message: `Unrecognized correct answer letter: ${question.correctAnswer}.`,
        retryable: false,
      };
    }

    const selectResult = DomHelpers.selectDropdown(Selectors.markCorrect.correctAnswerDropdown, value);

    if (!selectResult.success) {
      return selectResult;
    }

    return {
      success: true,
      message: getStateSuccessMessage("MARK_CORRECT"),
      retryable: false,
      focusTarget: Selectors.markCorrect.correctAnswerDropdown,
    };
  }

  function runGenerateAi() {
    if (!Session.hasCurrentQuestion()) {
      return {
        success: false,
        message: "No current question to generate AI content for.",
        retryable: false,
      };
    }

    const clickResult = DomHelpers.clickElement(Selectors.generateAi.generateButton);

    if (!clickResult.success) {
      return clickResult;
    }

    return {
      success: true,
      message: getStateSuccessMessage("GENERATE_AI"),
      retryable: false,
      focusTarget: Selectors.generateAi.generateButton,
    };
  }

  function runAddTags() {
    if (!Session.hasCurrentQuestion()) {
      return {
        success: false,
        message: "No current question to add tags for.",
        retryable: false,
      };
    }

    const question = Session.getCurrentQuestion();

    if (!question.subject) {
      return {
        success: false,
        message: "This question has no subject to tag.",
        retryable: false,
      };
    }

    const selectors = Selectors.addTags;

    const fillResult = DomHelpers.fillInput(selectors.tagInput, question.subject);
    if (!fillResult.success) {
      return fillResult;
    }

    const clickResult = DomHelpers.clickElement(selectors.addTagButton);
    if (!clickResult.success) {
      return clickResult;
    }

    return {
      success: true,
      message: getStateSuccessMessage("ADD_TAGS"),
      retryable: false,
      focusTarget: selectors.tagInput,
    };
  }

  function runSave() {
    if (!Session.hasCurrentQuestion()) {
      return {
        success: false,
        message: "No current question to save.",
        retryable: false,
      };
    }

    const clickResult = DomHelpers.clickElement(Selectors.save.saveButton);

    if (!clickResult.success) {
      return clickResult;
    }

    return {
      success: true,
      message: getStateSuccessMessage("SAVE"),
      retryable: false,
      focusTarget: Selectors.save.saveButton,
    };
  }

  function makeStubHandler(stateName) {
    return function () {
      if (!Session.hasCurrentQuestion()) {
        return {
          success: false,
          message: `No current question for ${stateName}.`,
          retryable: false,
        };
      }

      return {
        success: true,
        message: `${stateName} completed (stub — browser automation not yet implemented).`,
        retryable: false,
      };
    };
  }

  function runNextQuestion() {
    if (!Session.hasCurrentQuestion()) {
      return {
        success: false,
        message: "No current question to advance from.",
        retryable: false,
      };
    }

    Session.advanceToNextQuestion();

    return {
      success: true,
      message: getStateSuccessMessage("NEXT_QUESTION"),
      retryable: false,
    };
  }

  function runComplete() {
    return {
      success: true,
      message: getStateSuccessMessage("COMPLETE"),
      retryable: false,
    };
  }

  const STATE_HANDLERS = {
    IDLE: runIdle,
    PREPARE_FORM: runPrepareForm,
    PASTE_QUESTION: runPasteQuestion,
    PASTE_OPTIONS: runPasteOptions,
    MARK_CORRECT: runMarkCorrect,
    GENERATE_AI: runGenerateAi,
    ADD_TAGS: runAddTags,
    SAVE: runSave,
    NEXT_QUESTION: runNextQuestion,
    COMPLETE: runComplete,
  };

  function determineNextState(currentState) {
    if (currentState === "NEXT_QUESTION") {
      return Session.hasCurrentQuestion() ? "PREPARE_FORM" : "COMPLETE";
    }

    if (currentState === "COMPLETE") {
      return "COMPLETE";
    }

    if (currentState === "PASTE_QUESTION") {
      const question = Session.getCurrentQuestion();
      if (question && question.type === "NUMERICAL") {
        return "GENERATE_AI";
      }
    }

    // UPSC has no subjects/tags to add (see runAddTags, which this simply
    // never reaches for UPSC) — skip straight from GENERATE_AI to SAVE.
    if (currentState === "GENERATE_AI" && isUpscExamType(Session.getExamType())) {
      return "SAVE";
    }

    return NEXT_STATE[currentState];
  }

  async function executeStep() {
    const currentState = Session.getCurrentState();
    const handler = STATE_HANDLERS[currentState];

    if (!handler) {
      const result = {
        success: false,
        message: `Unknown state: ${currentState}`,
        retryable: false,
      };
      logTransition(currentState, result);
      return result;
    }

    // await works whether handler() returns a plain object (the stub /
    // session-only states) or a Promise (states that perform DOM waits) —
    // no need for each handler to be uniformly async.
    const result = await handler();
    logTransition(currentState, result);

    if (result.success) {
      Session.setCurrentState(determineNextState(currentState));

      if (result.focusTarget) {
        DomHelpers.scrollIntoView(result.focusTarget);
      }
    }

    return result;
  }

  function passStep() {
    const currentState = Session.getCurrentState();

    if (Session.getTotalQuestions() === 0) {
      const result = {
        success: false,
        message: "No question set loaded.",
        retryable: true,
      };
      logTransition(currentState, result);
      return result;
    }

    if (currentState === "NEXT_QUESTION") {
      Session.advanceToNextQuestion();
    }

    const message = getStateSuccessMessage(currentState);
    const nextState = determineNextState(currentState);

    Session.setCurrentState(nextState);

    const result = {
      success: true,
      message,
      retryable: false,
    };

    logTransition(currentState, result);

    return result;
  }

  function jumpFailure(message) {
    const result = {
      success: false,
      message,
      retryable: true,
    };
    logTransition("JUMP", result);
    return result;
  }

  function jumpToQuestion(rawInput) {
    if (Session.getTotalQuestions() === 0) {
      return jumpFailure("No question set loaded.");
    }

    const trimmed = typeof rawInput === "string" ? rawInput.trim() : "";

    if (!POSITIVE_INTEGER_PATTERN.test(trimmed)) {
      return jumpFailure("Enter a positive whole number.");
    }

    const questionNumber = Number(trimmed);

    if (!Number.isSafeInteger(questionNumber) || questionNumber === 0) {
      return jumpFailure("Enter a positive whole number.");
    }

    const total = Session.getTotalQuestions();

    if (questionNumber > total) {
      return jumpFailure(`Question ${questionNumber} does not exist in the loaded file (1-${total}).`);
    }

    Session.setCurrentQuestionIndex(questionNumber - 1);
    Session.setCurrentState("PREPARE_FORM");

    const result = {
      success: true,
      message: `Jumped to Question ${questionNumber}.`,
      retryable: false,
    };

    logTransition("JUMP", result);

    return result;
  }

  window.ExamUploadAssistantStateMachine = {
    STATES: Object.freeze({
      IDLE: "IDLE",
      PREPARE_FORM: "PREPARE_FORM",
      PASTE_QUESTION: "PASTE_QUESTION",
      PASTE_OPTIONS: "PASTE_OPTIONS",
      MARK_CORRECT: "MARK_CORRECT",
      GENERATE_AI: "GENERATE_AI",
      ADD_TAGS: "ADD_TAGS",
      SAVE: "SAVE",
      NEXT_QUESTION: "NEXT_QUESTION",
      COMPLETE: "COMPLETE",
    }),
    executeStep,
    passStep,
    jumpToQuestion,
  };
})();
