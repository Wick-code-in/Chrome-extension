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

  // --- Question Group support (additive — only ever reached for a
  // question whose parser-produced `group` field is non-null, which today
  // only happens for UPSC Paper II. JEE and UPSC Paper I never set
  // `group`, so none of this runs for them.) ---

  // The site's own per-card lettering is assigned sequentially as each Sub
  // Question card is added, in the same document order the parser already
  // sorted `group.questionNumbers` into — so a question's position in that
  // array is exactly which "Add Sub Question" click (and therefore which
  // lettered card) it corresponds to.
  function computeSubQuestionLetter(question) {
    const position = question.group.questionNumbers.indexOf(question.questionNumber);
    return Selectors.questionGroup.subQuestionLetterByPosition(position);
  }

  // Every reused per-question step (paste question, paste options, mark
  // correct, generate AI) needs to know which DOM root to operate within:
  // the whole document for a standalone question (JEE, Paper I, or an
  // ungoverned Paper II question), or that specific Sub Question card for
  // a Question Group member. The card is assumed to already exist by the
  // time this is called — it's created once, in PREPARE_FORM, via
  // ensureQuestionFormReady below.
  function resolveCurrentRoot(question) {
    if (!question.group) {
      return { success: true, element: document };
    }

    const letter = computeSubQuestionLetter(question);
    const element = DomHelpers.findElement(Selectors.questionGroup.subQuestionCard(letter));

    if (!element) {
      return {
        success: false,
        message: `Could not find the Sub Question card for Question ${question.questionNumber} on the page.`,
        retryable: true,
      };
    }

    return { success: true, element };
  }

  // Gets the form into a state where the reused prepareForm/pasteQuestion/
  // pasteOptions/markCorrect/generateAi fields can be filled, and returns
  // the root they should be scoped to. For a standalone question this is
  // exactly today's behavior (click Add Question, wait for Marks). For a
  // Question Group member: click "Add Question Group" and paste the
  // shared instruction/passage text ONLY for the first question in the
  // group (every later member reuses the group that's already open on the
  // page), then always click "Add Sub Question" and wait for that
  // specific lettered card to appear.
  async function ensureQuestionFormReady(question) {
    const selectors = Selectors.prepareForm;

    if (!question.group) {
      const clickResult = DomHelpers.clickElement(selectors.addQuestionButton);
      if (!clickResult.success) {
        return clickResult;
      }

      // The Marks field's own presence is just the readiness signal here —
      // unlike a Sub Question card, the standalone form has no container
      // of its own to scope later lookups to, so the root stays `document`
      // exactly as it was before Question Group support existed.
      const waitResult = await DomHelpers.waitForElement(selectors.marksInput);
      if (!waitResult.success) {
        return waitResult;
      }
      return { success: true, element: document };
    }

    const groupSelectors = Selectors.questionGroup;

    if (question.group.isFirstInGroup) {
      const clickGroupResult = DomHelpers.clickElement(groupSelectors.addQuestionGroupButton);
      if (!clickGroupResult.success) {
        return clickGroupResult;
      }

      const modalSelectors = Selectors.markdownImportModal;
      const pasteInstructionResult = await DomHelpers.pasteMarkdown(
        {
          triggerButton: groupSelectors.instructionMarkdownButton,
          modal: modalSelectors.container,
          textarea: modalSelectors.rawMarkdownTextarea,
          confirmButton: modalSelectors.renderAndInsertButton,
        },
        question.group.instructionMarkdown
      );
      if (!pasteInstructionResult.success) {
        return pasteInstructionResult;
      }
    }

    const clickSubResult = DomHelpers.clickElement(groupSelectors.addSubQuestionButton);
    if (!clickSubResult.success) {
      return clickSubResult;
    }

    const letter = computeSubQuestionLetter(question);
    return DomHelpers.waitForElement(groupSelectors.subQuestionCard(letter));
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

    const formReadyResult = await ensureQuestionFormReady(question);
    if (!formReadyResult.success) {
      return formReadyResult;
    }

    const root = formReadyResult.element;

    const typeResult = DomHelpers.selectDropdown(selectors.questionTypeDropdown, questionTypeValue, { root });
    if (!typeResult.success) {
      return typeResult;
    }

    const upscMarksPenalty = MARKS_PENALTY_BY_UPSC_PAPER[Session.getExamType()];
    const marksValue = upscMarksPenalty ? upscMarksPenalty.marks : PREPARE_FORM_MARKS_VALUE;
    const penaltyValue = upscMarksPenalty ? upscMarksPenalty.penalty : PREPARE_FORM_PENALTY_VALUE;

    const marksResult = DomHelpers.fillInput(selectors.marksInput, marksValue, { root });
    if (!marksResult.success) {
      return marksResult;
    }

    if (question.type === "MCQ") {
      const penaltyResult = DomHelpers.fillInput(selectors.penaltyInput, penaltyValue, { root });
      if (!penaltyResult.success) {
        return penaltyResult;
      }
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
    // A Question Group member must not re-paste the shared passage into
    // its own Question Text field — it already went into the group's
    // Instruction/Title block (see ensureQuestionFormReady). questionMarkdown
    // itself is left completely untouched (still the passage-duplicated
    // legacy value) as the rollback path: reverting this one line to
    // always read question.questionMarkdown restores the pre-Question-Group
    // upload behavior exactly. For an ungrouped question the two fields are
    // byte-identical, but it keeps reading questionMarkdown directly so
    // nothing about its path changes at all.
    const questionMarkdown = question.group ? question.questionOnlyMarkdown : question.questionMarkdown;

    if (!questionMarkdown) {
      return {
        success: false,
        message: "This question has no question text to paste.",
        retryable: false,
      };
    }

    const rootResult = resolveCurrentRoot(question);
    if (!rootResult.success) {
      return rootResult;
    }
    const root = rootResult.element;

    const modalSelectors = Selectors.markdownImportModal;

    const pasteResult = await DomHelpers.pasteMarkdown(
      {
        triggerButton: Selectors.pasteQuestion.markdownButton,
        modal: modalSelectors.container,
        textarea: modalSelectors.rawMarkdownTextarea,
        confirmButton: modalSelectors.renderAndInsertButton,
      },
      questionMarkdown,
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

    const rootResult = resolveCurrentRoot(question);
    if (!rootResult.success) {
      return rootResult;
    }
    const root = rootResult.element;

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
        optionText,
        { root }
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
      focusRoot: root,
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

    const rootResult = resolveCurrentRoot(question);
    if (!rootResult.success) {
      return rootResult;
    }
    const root = rootResult.element;

    const selectResult = DomHelpers.selectDropdown(Selectors.markCorrect.correctAnswerDropdown, value, { root });

    if (!selectResult.success) {
      return selectResult;
    }

    return {
      success: true,
      message: getStateSuccessMessage("MARK_CORRECT"),
      retryable: false,
      focusTarget: Selectors.markCorrect.correctAnswerDropdown,
      focusRoot: root,
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

    const question = Session.getCurrentQuestion();
    const rootResult = resolveCurrentRoot(question);
    if (!rootResult.success) {
      return rootResult;
    }
    const root = rootResult.element;

    const clickResult = DomHelpers.clickElement(Selectors.generateAi.generateButton, { root });

    if (!clickResult.success) {
      return clickResult;
    }

    return {
      success: true,
      message: getStateSuccessMessage("GENERATE_AI"),
      retryable: false,
      focusTarget: Selectors.generateAi.generateButton,
      focusRoot: root,
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
    // never reaches for UPSC) — skip straight from GENERATE_AI onward.
    if (currentState === "GENERATE_AI" && isUpscExamType(Session.getExamType())) {
      const question = Session.getCurrentQuestion();

      // A Question Group is saved once as a whole, not per sub-question —
      // only its last member reaches SAVE (which clicks the group's own
      // Save button); every earlier member skips straight to NEXT_QUESTION,
      // which simply advances Session to the next flat question exactly as
      // it already does today. No new state, no Session change: the next
      // question's own PREPARE_FORM (via ensureQuestionFormReady) is what
      // knows to add another Sub Question card to the group that's still
      // open, rather than starting a new one.
      if (question && question.group && !question.group.isLastInGroup) {
        return "NEXT_QUESTION";
      }

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
        DomHelpers.scrollIntoView(result.focusTarget, result.focusRoot);
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

    const targetQuestion = Session.getQuestions()[questionNumber - 1];

    // A Question Group can only be created on the website sequentially,
    // starting from its first sub-question — there is no valid entry
    // point into the middle of one. This isn't a convenience redirect, it
    // reflects that constraint: jumping to any non-first member always
    // lands on the group's first question instead, since that's the only
    // question number where a jump can actually be honored.
    if (targetQuestion && targetQuestion.group && !targetQuestion.group.isFirstInGroup) {
      const firstQuestionNumber = targetQuestion.group.questionNumbers[0];

      Session.setCurrentQuestionIndex(firstQuestionNumber - 1);
      Session.setCurrentState("PREPARE_FORM");

      const result = {
        success: true,
        message: `Question ${questionNumber} belongs to a Question Group beginning at Question ${firstQuestionNumber}. Redirecting to Question ${firstQuestionNumber}.`,
        retryable: false,
      };

      logTransition("JUMP", result);

      return result;
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
