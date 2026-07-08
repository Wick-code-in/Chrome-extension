(function () {
  // Selectors below are being verified one at a time against the live site
  // during Phase 7. Verified entries are marked as such; everything else
  // remains an unconfirmed placeholder until its own phase is reached. This
  // file is the only place a website selector should ever be written; no
  // other file should hardcode one.
  //
  // A selector value is one of:
  //   - a plain CSS string, consumed via querySelector, or
  //   - a { tag, text } descriptor: matched by tag name + exact visible
  //     text — used when an element's own visible text is the only stable
  //     identifier (e.g. a Tailwind-styled button with no other attributes), or
  //   - a { labelText } descriptor: finds the <label> with that exact text,
  //     then returns the first input/select/textarea within the label's
  //     parent — used for unlabeled fields where a sibling <label> carries
  //     the only stable identifier (no `for`/`id` link exists), or
  //   - a { optionValueParent } descriptor: finds the <option> with that
  //     exact value (a plain attribute selector — no relational CSS needed),
  //     then returns its parent <select> — used for a <select> with no
  //     stable attribute of its own.

  // The real site's internal value for "MCQ" (labelled "MCQ Choice" in the
  // UI) — not "MCQ". Defined once and reused below so the two places that
  // need it (finding the dropdown, and the value to assign to it) can't
  // drift apart.
  const MCQ_OPTION_VALUE = "single_choice";

  const SELECTORS = {
    prepareForm: {
      // VERIFIED (Phase 7): the button has no id/data-testid/aria-label —
      // only Tailwind utility classes, which are presentational and likely
      // shared with other primary-action buttons (Save, Generate with AI).
      // Matching by visible text is the most stable option available.
      addQuestionButton: { tag: "button", text: "Add Question" },
      // VERIFIED (Phase 7): native <select>, no stable attribute of its own.
      // Identified via its child option's value (plain attribute selector +
      // parentElement) rather than the :has() relational selector — this
      // relies only on CSS features supported since CSS2, with no browser
      // version floor at all, and reaches the same element just as precisely.
      questionTypeDropdown: { optionValueParent: MCQ_OPTION_VALUE },
      mcqOptionValue: MCQ_OPTION_VALUE,
      // VERIFIED (Phase 7): neither the wrapping <div> nor the <label> has
      // any attribute beyond presentational classes, and there is no
      // for/id link between the label and the input. Matching the label's
      // text and taking the form control from within its parent is the
      // only stable option.
      marksInput: { labelText: "Marks" },
      // VERIFIED (Phase 7): identical pattern to Marks — no attribute on
      // the wrapper or label beyond presentational classes.
      penaltyInput: { labelText: "Penalty" },
    },
    pasteQuestion: {
      questionMarkdownField: '[data-testid="question-markdown-field"]',
      applyButton: '[data-testid="question-markdown-apply-button"]',
    },
    pasteOptions: {
      optionField: (letter) => `[data-testid="option-${letter.toLowerCase()}-field"]`,
    },
    markCorrect: {
      correctOptionControl: (letter) => `[data-testid="option-${letter.toLowerCase()}-correct-control"]`,
    },
    generateAi: {
      generateButton: '[data-testid="generate-ai-button"]',
      generationInProgressIndicator: '[data-testid="ai-generation-in-progress"]',
    },
    save: {
      saveButton: '[data-testid="save-question-button"]',
      saveDialog: '[data-testid="save-question-dialog"]',
      questionCreatedConfirmation: '[data-testid="question-created-confirmation"]',
    },
  };

  window.ExamUploadAssistantSelectors = SELECTORS;
})();
