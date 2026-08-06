(function () {
  const Session = window.ExamUploadAssistantSession;
  const DomHelpers = window.ExamUploadAssistantDomHelpers;
  const Selectors = window.ExamUploadAssistantSelectors;
  const MarkingSchemes = window.ExamUploadAssistantMarkingSchemes;

  const POSITIVE_INTEGER_PATTERN = /^\d+$/;
  const OPTION_LETTERS = ["A", "B", "C", "D"];
  // Longer than the default 10s wait timeout — a real generation was
  // observed completing in ~1.5s, but that's one sample against a live AI
  // service, not a guaranteed upper bound.
  const GENERATE_AI_TIMEOUT_MS = 30000;

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
        return "AI content generated.";
      case "ADD_TAGS":
        return "Tag added.";
      case "SAVE":
        return "Question saved.";
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

    // --- TEMPORARY DIAGNOSTICS (Windows PASTE_QUESTION investigation only).
    // Self-contained here, independent of the __diagnosticTag instrumentation
    // inside DomHelpers.pasteMarkdown() below (see there for the click/wait-
    // boundary checks and the +100/300/600/1000/2000ms follow-ups) — this
    // block covers the read-only pre-click facts that don't depend on that
    // flag propagating correctly at all: button found/visible/disabled,
    // whether it's connected to the DOM, and document.activeElement before
    // anything happens. Every line here is read-only; the real logic below
    // is unchanged. Remove this block, the __diagnosticTag line below it,
    // and the matching instrumentation in domHelpers.js once the platform
    // difference is understood.
    {
      const selectors = Selectors.pasteQuestion;
      const preClickButton = DomHelpers.findElement(selectors.markdownButton, root);
      console.log(
        "[Docxsity][PASTE_QUESTION][DIAG] pre-click (in runPasteQuestion):",
        JSON.stringify({
          buttonFound: !!preClickButton,
          buttonVisible: preClickButton ? DomHelpers.isVisible(preClickButton) : null,
          buttonDisabled: preClickButton
            ? preClickButton.disabled === true || preClickButton.getAttribute("aria-disabled") === "true"
            : null,
          buttonConnectedToDom: preClickButton ? preClickButton.isConnected : null,
          activeElementTag: document.activeElement ? document.activeElement.tagName : null,
          activeElementClass: document.activeElement ? String(document.activeElement.className) : null,
        })
      );
    }
    // --- END TEMPORARY DIAGNOSTICS ---

    // TEMP DIAGNOSTIC (Windows PASTE_QUESTION investigation only):
    // __diagnosticTag opts this one call site into the instrumentation
    // inside DomHelpers.pasteMarkdown() (see there) — every other caller
    // (PASTE_OPTIONS) passes no such flag and is completely unaffected, and
    // the real click/wait/fill/click/wait sequence itself is byte-for-byte
    // unchanged either way. Remove this one line alongside the
    // instrumentation in domHelpers.js once the platform difference is
    // understood.
    const pasteResult = await DomHelpers.pasteMarkdown(
      {
        triggerButton: Selectors.pasteQuestion.markdownButton,
        modal: modalSelectors.container,
        textarea: modalSelectors.rawMarkdownTextarea,
        confirmButton: modalSelectors.renderAndInsertButton,
      },
      question.questionMarkdown,
      { root, __diagnosticTag: "PASTE_QUESTION" }
    );

    // TEMP DIAGNOSTIC — immediately before this function's own return,
    // unconditionally (runs whether pasteResult succeeded or failed).
    console.log(
      "[Docxsity][PASTE_QUESTION][DIAG] pasteMarkdown() final outcome:",
      JSON.stringify({ success: pasteResult.success, message: pasteResult.message })
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

  // Deliberately does not touch the AI model picker (<app-multi-models>) —
  // it always defaults to "Default" pre-selected and needs no interaction,
  // confirmed live. Same workflow for MCQ Choice and Fill Blank; not
  // special-cased since the reconnaissance found no behavioral difference
  // between them for this state (both have the button present and enabled).
  async function runGenerateAi() {
    if (!Session.hasCurrentQuestion()) {
      return {
        success: false,
        message: "No current question to generate AI content for.",
        retryable: false,
      };
    }

    const modalResult = await DomHelpers.waitForElement(Selectors.addQuestionModal);
    if (!modalResult.success) {
      return modalResult;
    }

    const root = modalResult.element;
    const buttonSelector = Selectors.generateAi.generateButtonSelector;

    const clickResult = DomHelpers.clickElement(buttonSelector, { root });
    if (!clickResult.success) {
      return clickResult;
    }

    // Two-phase wait, not a single "not disabled" check: immediately after
    // the click the button can still momentarily read as enabled (observed
    // live — still enabled at 100ms, only disabled by 500ms), so waiting
    // for the disabled state first is what makes the second wait an actual
    // completion signal rather than a race that could resolve instantly.
    const disabledResult = await DomHelpers.waitForElement(`${buttonSelector}[disabled]`, { root });
    if (!disabledResult.success) {
      return disabledResult;
    }

    const enabledResult = await DomHelpers.waitForElement(`${buttonSelector}:not([disabled])`, {
      root,
      timeoutMs: GENERATE_AI_TIMEOUT_MS,
    });
    if (!enabledResult.success) {
      return enabledResult;
    }

    // Post-condition verification (not the wait condition): confirm AI
    // generation actually produced content, the same way every earlier
    // state verifies its own effect before reporting success.
    const explanationElement = DomHelpers.findElement(Selectors.generateAi.explanationEditor, root);
    const explanationIframe = explanationElement ? explanationElement.querySelector("iframe") : null;

    let explanationText = "";
    try {
      explanationText = explanationIframe ? explanationIframe.contentDocument.body.textContent.trim() : "";
    } catch (error) {
      explanationText = "";
    }

    if (!explanationText) {
      return {
        success: false,
        message:
          "AI generation finished, but the Explanation field is still empty. Check the target website manually, then use Pass Step to continue if this is expected.",
        retryable: true,
      };
    }

    return {
      success: true,
      message: getStateSuccessMessage("GENERATE_AI"),
      retryable: false,
      focusTarget: Selectors.generateAi.explanationEditor,
      focusRoot: root,
    };
  }

  // Exactly one responsibility: transfer question.subject (parsed directly
  // from the source document — never AI-inferred, never guessed) into a
  // top-level tag. Never touches "+ Sub Tag" or "Remove" — no sub-tag data
  // exists in the parsed Question Object, and Remove is destructive.
  async function runAddTags() {
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
        success: true,
        message: "This question has no subject to tag — skipped.",
        retryable: false,
      };
    }

    const modalResult = await DomHelpers.waitForElement(Selectors.addQuestionModal);
    if (!modalResult.success) {
      return modalResult;
    }

    const root = modalResult.element;
    const selectors = Selectors.addTags;

    const fillResult = DomHelpers.fillInput(selectors.tagInput, question.subject, { root });
    if (!fillResult.success) {
      return fillResult;
    }

    const clickResult = DomHelpers.clickElement(selectors.addTagButton, { root });
    if (!clickResult.success) {
      return clickResult;
    }

    // Completion signal: wait for the tag's own pill to appear with the
    // exact subject text — not the input clearing, not a fixed delay.
    const pillResult = await DomHelpers.waitForElement(selectors.tagPill(question.subject), { root });
    if (!pillResult.success) {
      return pillResult;
    }

    return {
      success: true,
      message: getStateSuccessMessage("ADD_TAGS"),
      retryable: false,
      focusTarget: selectors.tagPill(question.subject),
      focusRoot: root,
    };
  }

  // Standalone Add Question only — no Question Group save behavior here.
  async function runSave() {
    if (!Session.hasCurrentQuestion()) {
      return {
        success: false,
        message: "No current question to save.",
        retryable: false,
      };
    }

    const modalResult = await DomHelpers.waitForElement(Selectors.addQuestionModal);
    if (!modalResult.success) {
      return modalResult;
    }

    const root = modalResult.element;
    const selectors = Selectors.save;

    const clickResult = DomHelpers.clickElement(selectors.saveButton, { root });
    if (!clickResult.success) {
      return clickResult;
    }

    // Completion signal: the Add Question modal disappearing — not a fixed
    // delay, not network activity, not a toast (none was confirmed to
    // exist reliably in reconnaissance).
    const disappearResult = await DomHelpers.waitForDisappear(Selectors.addQuestionModal);

    if (!disappearResult.success) {
      // The modal is still open, so `root` is still a live, attached
      // element — read its inline validation errors directly rather than
      // surfacing a generic timeout. VERIFIED live: on an invalid form the
      // modal stays open and these appear, one per invalid field.
      const errorMessages = Array.from(root.querySelectorAll(selectors.validationErrorSelector))
        .map((element) => element.textContent.trim())
        .filter(Boolean);

      if (errorMessages.length > 0) {
        return {
          success: false,
          message: `Could not save the question: ${errorMessages.join(" ")}`,
          retryable: true,
        };
      }

      return disappearResult;
    }

    return {
      success: true,
      message: getStateSuccessMessage("SAVE"),
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

    // Fill Blank has no Options/Correct-Answer mechanism at all — VERIFIED
    // live: Question Type "Fill Blank" collapses option cards to 0, and
    // "Select Correct Answer" plus every per-option "Mark as Correct"
    // button simply don't exist. Skip straight from PASTE_QUESTION to
    // GENERATE_AI, mirroring sites/modality/stateMachine.js's identical
    // skip for its own NUMERICAL type. ADD_TAGS is deliberately NOT
    // skipped here — it already runs unconditionally after GENERATE_AI via
    // NEXT_STATE below, and runAddTags() itself is what decides whether
    // there's a subject to tag (a successful no-op when there isn't).
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
