(function () {
  const Session = window.ExamUploadAssistantSession;
  const DomHelpers = window.ExamUploadAssistantDomHelpers;
  const Selectors = window.ExamUploadAssistantSelectors;
  const MarkingSchemes = window.ExamUploadAssistantMarkingSchemes;

  const POSITIVE_INTEGER_PATTERN = /^\d+$/;

  // Real automation replaces makeStubHandler's callers one state at a time
  // as each is itself live-verified (PREPARE_FORM first; see the Docxsity
  // V2 design doc's phase roadmap), mirroring the run*/STATE_HANDLERS shape
  // sites/modality/stateMachine.js already uses — but never sharing code
  // with it.
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
    console.log("[Exam Upload Assistant · Docxsity]", state, "->", result);
  }

  function getStateSuccessMessage(state) {
    switch (state) {
      case "IDLE":
        return "Ready to begin.";
      case "PREPARE_FORM":
        return "Question prepared.";
      case "PASTE_QUESTION":
        return "Question pasted.";
      case "PASTE_OPTIONS":
        return "PASTE_OPTIONS completed (stub — Docxsity automation not yet implemented).";
      case "MARK_CORRECT":
        return "MARK_CORRECT completed (stub — Docxsity automation not yet implemented).";
      case "GENERATE_AI":
        return "GENERATE_AI completed (stub — Docxsity automation not yet implemented).";
      case "ADD_TAGS":
        return "ADD_TAGS completed (stub — Docxsity automation not yet implemented).";
      case "SAVE":
        return "SAVE completed (stub — Docxsity automation not yet implemented).";
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

    return { success: true, message: getStateSuccessMessage("IDLE"), retryable: false };
  }

  // Modal-root-once pattern (standard for Docxsity, per the project's
  // explicit convention): click Add Question, wait for its modal once, then
  // scope every field lookup for this workflow to that resolved root —
  // never search document unscoped, even though today (an empty question
  // bank) an unscoped lookup would happen to work too.
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

    const examType = Session.getExamType();
    const markingScheme = MarkingSchemes.getMarkingScheme(examType);

    if (!markingScheme) {
      return {
        success: false,
        message: `No marking scheme configured for exam type "${examType}". Add one to sites/docxsity/config/markingSchemes.js before continuing.`,
        retryable: false,
      };
    }

    const clickResult = DomHelpers.clickElement(selectors.addQuestionButton);
    if (!clickResult.success) {
      return clickResult;
    }

    const modalResult = await DomHelpers.waitForElement(Selectors.addQuestionModal);
    if (!modalResult.success) {
      return modalResult;
    }

    const root = modalResult.element;

    const typeResult = await DomHelpers.selectDropdown(selectors.questionTypeDropdown, questionTypeValue, { root });
    if (!typeResult.success) {
      return typeResult;
    }

    const marksResult = DomHelpers.fillInput(selectors.marksInput, markingScheme.marks, { root });
    if (!marksResult.success) {
      return marksResult;
    }

    // VERIFIED: unlike Modality (which skips Penalty for its non-MCQ
    // question type), Docxsity's Penalty field stays present and enabled
    // regardless of Question Type — filled unconditionally for every type.
    const penaltyResult = DomHelpers.fillInput(selectors.penaltyInput, markingScheme.penalty, { root });
    if (!penaltyResult.success) {
      return penaltyResult;
    }

    return {
      success: true,
      message: getStateSuccessMessage("PREPARE_FORM"),
      retryable: false,
      focusTarget: selectors.questionTypeDropdown,
      focusRoot: root,
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

    if (!question.questionMarkdown) {
      return {
        success: false,
        message: "This question has no question text to paste.",
        retryable: false,
      };
    }

    // The Add Question modal PREPARE_FORM opened is still on the page —
    // state handlers don't carry DOM references to each other (mirrors
    // sites/modality/stateMachine.js's own resolveCurrentRoot, which
    // re-resolves its root fresh every state rather than threading one
    // through Session), so re-resolve it the same way PREPARE_FORM did.
    // Since the modal is already open, this settles near-instantly.
    const modalResult = await DomHelpers.waitForElement(Selectors.addQuestionModal);
    if (!modalResult.success) {
      return modalResult;
    }

    const root = modalResult.element;
    const modalSelectors = Selectors.markdownImportModal;

    const pasteResult = await DomHelpers.pasteMarkdown(
      {
        triggerButton: Selectors.pasteQuestion.markdownButton,
        modal: modalSelectors.container,
        textarea: modalSelectors.rawMarkdownTextarea,
        confirmButton: modalSelectors.renderAndInsertButton,
      },
      question.questionMarkdown,
      { root }
    );

    if (!pasteResult.success) {
      return pasteResult;
    }

    return {
      success: true,
      message: getStateSuccessMessage("PASTE_QUESTION"),
      retryable: false,
      focusTarget: Selectors.pasteQuestion.markdownButton,
      focusRoot: root,
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

      return { success: true, message: getStateSuccessMessage(stateName), retryable: false };
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

    return { success: true, message: getStateSuccessMessage("NEXT_QUESTION"), retryable: false };
  }

  function runComplete() {
    return { success: true, message: getStateSuccessMessage("COMPLETE"), retryable: false };
  }

  const STATE_HANDLERS = {
    IDLE: runIdle,
    PREPARE_FORM: runPrepareForm,
    PASTE_QUESTION: runPasteQuestion,
    PASTE_OPTIONS: makeStubHandler("PASTE_OPTIONS"),
    MARK_CORRECT: makeStubHandler("MARK_CORRECT"),
    GENERATE_AI: makeStubHandler("GENERATE_AI"),
    ADD_TAGS: makeStubHandler("ADD_TAGS"),
    SAVE: makeStubHandler("SAVE"),
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

    return NEXT_STATE[currentState];
  }

  async function executeStep() {
    const currentState = Session.getCurrentState();
    const handler = STATE_HANDLERS[currentState];

    if (!handler) {
      const result = { success: false, message: `Unknown state: ${currentState}`, retryable: false };
      logTransition(currentState, result);
      return result;
    }

    const result = await handler();
    logTransition(currentState, result);

    if (result.success) {
      Session.setCurrentState(determineNextState(currentState));
    }

    return result;
  }

  function passStep() {
    const currentState = Session.getCurrentState();

    if (Session.getTotalQuestions() === 0) {
      const result = { success: false, message: "No question set loaded.", retryable: true };
      logTransition(currentState, result);
      return result;
    }

    if (currentState === "NEXT_QUESTION") {
      Session.advanceToNextQuestion();
    }

    const message = getStateSuccessMessage(currentState);
    const nextState = determineNextState(currentState);

    Session.setCurrentState(nextState);

    const result = { success: true, message, retryable: false };
    logTransition(currentState, result);

    return result;
  }

  function jumpFailure(message) {
    const result = { success: false, message, retryable: true };
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

    const result = { success: true, message: `Jumped to Question ${questionNumber}.`, retryable: false };
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
