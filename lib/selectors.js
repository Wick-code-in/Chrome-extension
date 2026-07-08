(function () {
  // Placeholder selectors. The real target site has not been inspected yet —
  // every value below must be verified and corrected once the phase that
  // uses it is actually run against the live site. This file is the only
  // place a website selector should ever be written; no other file should
  // hardcode one.

  const SELECTORS = {
    prepareForm: {
      addQuestionButton: '[data-testid="add-question-button"]',
      questionTypeDropdown: '[data-testid="question-type-dropdown"]',
      mcqOption: '[data-testid="question-type-option-mcq"]',
      marksInput: '[data-testid="marks-input"]',
      penaltyInput: '[data-testid="penalty-input"]',
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
