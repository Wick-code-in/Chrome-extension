(function () {
  const Session = window.ExamUploadAssistantSession;

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

  function runPrepareForm() {
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

    return {
      success: true,
      message: "PREPARE_FORM completed (stub — browser automation not yet implemented).",
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

  function executeStep() {
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

    const result = handler();
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
