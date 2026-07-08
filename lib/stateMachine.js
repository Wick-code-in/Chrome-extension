(function () {
  const Session = window.ExamUploadAssistantSession;
  const DomHelpers = window.ExamUploadAssistantDomHelpers;
  const Selectors = window.ExamUploadAssistantSelectors;

  const PREPARE_FORM_MARKS_VALUE = "4";
  const PREPARE_FORM_PENALTY_VALUE = "1";

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
      message: "Ready to begin.",
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

    const typeResult = DomHelpers.selectDropdown(selectors.questionTypeDropdown, selectors.mcqOptionValue);
    if (!typeResult.success) {
      return typeResult;
    }

    const marksResult = DomHelpers.fillInput(selectors.marksInput, PREPARE_FORM_MARKS_VALUE);
    if (!marksResult.success) {
      return marksResult;
    }

    const penaltyResult = DomHelpers.fillInput(selectors.penaltyInput, PREPARE_FORM_PENALTY_VALUE);
    if (!penaltyResult.success) {
      return penaltyResult;
    }

    return {
      success: true,
      message: "PREPARE_FORM completed.",
      retryable: false,
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
      message: Session.hasCurrentQuestion()
        ? "Advanced to the next question."
        : "All questions complete.",
      retryable: false,
    };
  }

  function runComplete() {
    return {
      success: true,
      message: "All questions are complete.",
      retryable: false,
    };
  }

  const STATE_HANDLERS = {
    IDLE: runIdle,
    PREPARE_FORM: runPrepareForm,
    PASTE_QUESTION: makeStubHandler("PASTE_QUESTION"),
    PASTE_OPTIONS: makeStubHandler("PASTE_OPTIONS"),
    MARK_CORRECT: makeStubHandler("MARK_CORRECT"),
    GENERATE_AI: makeStubHandler("GENERATE_AI"),
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
    }

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
  };
})();
