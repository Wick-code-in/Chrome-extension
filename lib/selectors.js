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
  //   - a { labelText, find } descriptor: finds the <label> with that exact
  //     text, then returns the first match of `find` (defaults to "input,
  //     select, textarea") within the smallest ancestor of the label that
  //     contains one — the label and the target aren't always direct
  //     siblings (e.g. an Option's label and its editor's toolbar button
  //     are two levels apart), so this walks upward until it finds one,
  //     stopping at the shallowest match to stay scoped to that one field, or
  //   - a { optionValueParent } descriptor: finds the <option> with that
  //     exact value (a plain attribute selector — no relational CSS needed),
  //     then returns its parent <select> — used for a <select> with no
  //     stable attribute of its own, or
  //   - a { tag, text, closest } descriptor: finds the element matching
  //     `tag` with that exact visible text, then (if `closest` is given)
  //     walks up to its nearest ancestor matching that CSS selector — used
  //     when the stable text belongs to a descendant (e.g. a dialog's
  //     title) rather than the container itself, whose own attributes recur
  //     across multiple structurally-identical dialogs.

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
    // Shared "Markdown import" modal used by DomHelpers.pasteMarkdown() for
    // every rich-text field (Question, each Option, Explanation) — the same
    // dialog is reused every time; only each field's own trigger button
    // (below, per section) differs.
    markdownImportModal: {
      // VERIFIED (Phase 8): the dialog itself only has generic TinyMCE
      // dialog chrome (role="dialog", aria-modal) that's almost certainly
      // shared with TinyMCE's other dialogs (image/link/table insert,
      // etc.), and its aria-labelledby target id looks auto-generated per
      // render — not safe to hardcode. Instead: find the title element by
      // its exact, stable text ("Paste Markdown Data"), then walk up to
      // its enclosing dialog via closest(). Used for both the
      // wait-for-appear and wait-for-disappear checks.
      container: { tag: "div", text: "Paste Markdown Data", closest: '[role="dialog"]' },
      // VERIFIED (Phase 8): has a for/id-linked <label>, but the id looks
      // auto-generated per render (not safe to hardcode). The label's text
      // ("Raw Markdown") is stable; findByLabelText locates the textarea
      // nested inside the label's parent without needing the id at all.
      // This lookup is scoped to the modal element found above (see
      // DomHelpers.pasteMarkdown), so it never needs to search the whole
      // document.
      rawMarkdownTextarea: { labelText: "Raw Markdown" },
      // VERIFIED (Phase 8): no aria-label, but has both a matching `title`
      // and matching visible text ("Render & Insert"). Using the same
      // {tag, text} approach already proven for "Add Question", scoped to
      // the modal element (see above) rather than the whole document.
      renderAndInsertButton: { tag: "button", text: "Render & Insert" },
    },
    pasteQuestion: {
      // VERIFIED (Phase 8): the button itself has a genuine aria-label
      // ("Paste Raw Markdown") — the first stable non-Tailwind attribute
      // found on this site so far. It must still be scoped to the Question
      // field's own labeled container, though: the identical TinyMCE
      // toolbar (and therefore an identical aria-label) will also appear
      // for every Option and the Explanation once those exist, so a bare
      // attribute selector would ambiguously match whichever one happens to
      // render first in the DOM. The label's exact text includes the
      // required-field marker as rendered: "Question Text *".
      markdownButton: { labelText: "Question Text *", find: 'button[aria-label="Paste Raw Markdown"]' },
    },
    // Maps our internal option letters (from the parsed Question Object) to
    // the site's own option numbering, sequentially.
    optionNumberByLetter: { A: 1, B: 2, C: 3, D: 4 },
    pasteOptions: {
      // VERIFIED (Phase 9): each option's label is exactly "Option N" (no
      // trailing required-marker, unlike Question's "Question Text *").
      // The label and its editor's toolbar button are NOT direct
      // siblings here (label is 2 levels deep in a header row; the editor
      // is a separate sibling subtree) — the same {labelText, find}
      // approach still applies, since it now walks upward to find the
      // smallest ancestor containing the button rather than assuming a
      // fixed depth.
      markdownButton: (letter) => ({
        labelText: `Option ${SELECTORS.optionNumberByLetter[letter]}`,
        find: 'button[aria-label="Paste Raw Markdown"]',
      }),
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
