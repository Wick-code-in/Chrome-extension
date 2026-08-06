(function () {
  const Session = window.ExamUploadAssistantSession;
  const DomHelpers = window.ExamUploadAssistantDomHelpers;
  const Selectors = window.ExamUploadAssistantSelectors;
  const MarkingSchemes = window.ExamUploadAssistantMarkingSchemes;

  const POSITIVE_INTEGER_PATTERN = /^\d+$/;
  const OPTION_LETTERS = ["A", "B", "C", "D"];

  // Own copy of the same UPSC/no-answer-key distinction
  // sites/modality/stateMachine.js makes — not shared code, just the same
  // already-established business fact (some UPSC papers ship with no
  // answer key at all) reused for the same operator-facing message.
  function isUpscExamType(examType) {
    return examType === "UPSC_PAPER_I" || examType === "UPSC_PAPER_II";
  }

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
        return "Options pasted.";
      case "MARK_CORRECT":
        return "Correct answer selected.";
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

  // Responsibility 1 of 2 for PASTE_OPTIONS (kept deliberately separate from
  // population, per explicit direction): ensure exactly `count` option
  // cards exist. Only Option 1 exists when the Add Question modal opens —
  // every card past that is created one at a time. For each position,
  // check (read-only, no wait) whether that specific card already exists;
  // if not, click "Add Option" once and wait for that specific card to
  // appear before ever considering the next position. Never clicks more
  // than once without first observing the DOM in between — this is exactly
  // what addresses the earlier live observation where rapid, unobserved
  // clicks appeared to create duplicate cards.
  //
  // Composed entirely from existing DomHelpers primitives (findElement,
  // clickElement, waitForElement) — no new primitive was needed for this.
  async function ensureOptionCount(root, count) {
    let existingCount = 0;
    let createdCount = 0;

    for (let number = 1; number <= count; number += 1) {
      const cardSelector = Selectors.pasteOptions.optionCard(number);
      const alreadyPresent = DomHelpers.findElement(cardSelector, root);

      if (alreadyPresent) {
        existingCount += 1;
        continue;
      }

      const clickResult = DomHelpers.clickElement(Selectors.pasteOptions.addOptionButton, { root });
      if (!clickResult.success) {
        return { success: false, message: clickResult.message, retryable: true, existingCount, createdCount };
      }

      const waitResult = await DomHelpers.waitForElement(cardSelector, { root });
      if (!waitResult.success) {
        return { success: false, message: waitResult.message, retryable: true, existingCount, createdCount };
      }

      createdCount += 1;
    }

    return { success: true, message: `Ensured ${count} option cards exist.`, retryable: false, existingCount, createdCount };
  }

  // Responsibility 2 of 2 for PASTE_OPTIONS: once a card is known to exist,
  // resolve it and reuse DomHelpers.pasteMarkdown() unchanged — identical
  // call shape to PASTE_QUESTION's, just with each option's own card as
  // `root` (instead of the whole Add Question modal) and a plain scoped
  // selector as the trigger (instead of a {labelText} descriptor, since
  // Options have no <label> to anchor to). No new TinyMCE primitive is
  // needed: the interaction is genuinely identical to Question Text's.
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

    const modalResult = await DomHelpers.waitForElement(Selectors.addQuestionModal);
    if (!modalResult.success) {
      return modalResult;
    }

    const root = modalResult.element;

    const ensureResult = await ensureOptionCount(root, OPTION_LETTERS.length);
    if (!ensureResult.success) {
      return ensureResult;
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

      const number = Selectors.pasteOptions.optionNumberByLetter[letter];
      const cardResult = await DomHelpers.waitForElement(Selectors.pasteOptions.optionCard(number), { root });

      if (!cardResult.success) {
        return cardResult;
      }

      const pasteResult = await DomHelpers.pasteMarkdown(
        {
          triggerButton: Selectors.pasteOptions.markdownButtonSelector,
          modal: modalSelectors.container,
          textarea: modalSelectors.rawMarkdownTextarea,
          confirmButton: modalSelectors.renderAndInsertButton,
        },
        optionText,
        { root: cardResult.element }
      );

      if (!pasteResult.success) {
        return pasteResult;
      }
    }

    return {
      success: true,
      message: getStateSuccessMessage("PASTE_OPTIONS"),
      retryable: false,
      focusTarget: Selectors.pasteOptions.optionCard(OPTION_LETTERS.length),
      focusRoot: root,
    };
  }

  // Automates the per-option "Mark as Correct" button, not the Correct
  // Answer dropdown — the button is identical in both standalone and Sub
  // Question contexts, while the dropdown's control type isn't (native
  // <select> vs <ng-select>, live-confirmed). Reuses the same
  // pasteOptions.optionCard(number) resolution PASTE_OPTIONS already uses;
  // no new lookup strategy needed.
  async function runMarkCorrect() {
    if (!Session.hasCurrentQuestion()) {
      return {
        success: false,
        message: "No current question to mark correct.",
        retryable: false,
      };
    }

    const question = Session.getCurrentQuestion();

    // VERIFIED: Fill Blank has no correct-answer mechanism at all — its
    // "Select Correct Answer" / per-option buttons are replaced entirely by
    // "Answers for Blanks" / "Case Sensitive Matching". Not an error: this
    // state simply doesn't apply to this question type.
    if (question.type === "NUMERICAL") {
      return {
        success: true,
        message: "Fill Blank questions have no correct-answer mechanism to mark — skipped.",
        retryable: false,
      };
    }

    if (!question.correctAnswer) {
      const message = isUpscExamType(Session.getExamType())
        ? "This paper does not contain an answer key for this question. Mark the correct option manually on the target website, then use Pass Step to continue."
        : "This question has no correct answer to select.";

      return {
        success: false,
        message,
        retryable: false,
      };
    }

    const number = Selectors.pasteOptions.optionNumberByLetter[question.correctAnswer];

    if (!number) {
      return {
        success: false,
        message: `Unrecognized correct answer letter: ${question.correctAnswer}.`,
        retryable: false,
      };
    }

    const modalResult = await DomHelpers.waitForElement(Selectors.addQuestionModal);
    if (!modalResult.success) {
      return modalResult;
    }

    const root = modalResult.element;

    const cardResult = await DomHelpers.waitForElement(Selectors.pasteOptions.optionCard(number), { root });
    if (!cardResult.success) {
      return cardResult;
    }

    const clickResult = DomHelpers.clickElement(Selectors.markCorrect.correctButtonSelector, { root: cardResult.element });
    if (!clickResult.success) {
      return clickResult;
    }

    // Completion signal: wait for THIS option's own button to carry the
    // active class — an observable DOM state, not a fixed delay.
    const activeSelector = `${Selectors.markCorrect.correctButtonSelector}.${Selectors.markCorrect.activeButtonClass}`;
    const activeResult = await DomHelpers.waitForElement(activeSelector, { root: cardResult.element });

    if (!activeResult.success) {
      return activeResult;
    }

    return {
      success: true,
      message: getStateSuccessMessage("MARK_CORRECT"),
      retryable: false,
      focusTarget: activeResult.element,
      focusRoot: cardResult.element,
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
    PASTE_OPTIONS: runPasteOptions,
    MARK_CORRECT: runMarkCorrect,
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
