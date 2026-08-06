(function () {
  const Session = window.ExamUploadAssistantSession;

  const POSITIVE_INTEGER_PATTERN = /^\d+$/;

  // Phase 0 scaffolding only. Every step below is a stub that advances the
  // workflow and reports success without touching the page — there is no
  // DomHelpers/Selectors dependency yet because there is no verified DOM
  // fact to act on (see the Docxsity V2 design doc, Phase 1). Real
  // automation replaces makeStubHandler's callers one state at a time,
  // mirroring the run*/STATE_HANDLERS shape sites/modality/stateMachine.js
  // already uses — this file's job right now is only to prove the
  // extension loads, the panel drives it, and Session/Parser work
  // unmodified against a second site.
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
        return "PREPARE_FORM completed (stub — Docxsity automation not yet implemented).";
      case "PASTE_QUESTION":
        return "PASTE_QUESTION completed (stub — Docxsity automation not yet implemented).";
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
    PREPARE_FORM: makeStubHandler("PREPARE_FORM"),
    PASTE_QUESTION: makeStubHandler("PASTE_QUESTION"),
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
