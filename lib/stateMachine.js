(function () {
  const Session = window.ExamUploadAssistantSession;
  const DomHelpers = window.ExamUploadAssistantDomHelpers;
  const Selectors = window.ExamUploadAssistantSelectors;

  const PREPARE_FORM_MARKS_VALUE = "4";
  const PREPARE_FORM_PENALTY_VALUE = "1";
  const OPTION_LETTERS = ["A", "B", "C", "D"];
  const POSITIVE_INTEGER_PATTERN = /^\d+$/;

  const NEXT_STATE = {
    IDLE: "PREPARE_FORM",
    PREPARE_FORM: "PASTE_QUESTION",
    PASTE_QUESTION: "PASTE_OPTIONS",
    PASTE_OPTIONS: "MARK_CORRECT",
    MARK_CORRECT: "GENERATE_AI",
    GENERATE_AI: "SAVE",
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

    const marksResult = DomHelpers.fillInput(selectors.marksInput, PREPARE_FORM_MARKS_VALUE);
    if (!marksResult.success) {
      return marksResult;
    }

    if (question.type === "MCQ") {
      const penaltyResult = DomHelpers.fillInput(selectors.penaltyInput, PREPARE_FORM_PENALTY_VALUE);
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
      return {
        success: false,
        message: "This question has no correct answer to select.",
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
      SAVE: "SAVE",
      NEXT_QUESTION: "NEXT_QUESTION",
      COMPLETE: "COMPLETE",
    }),
    executeStep,
    passStep,
    jumpToQuestion,
  };
})();
