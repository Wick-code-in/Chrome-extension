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
  //   - a { optionValueParent, nearLabel } descriptor: finds the <option>
  //     with that exact value (a plain attribute selector — no relational
  //     CSS needed), then returns its parent <select> — used for a <select>
  //     with no stable attribute of its own. Unscoped unless `nearLabel` is
  //     given, in which case the option search is scoped to the smallest
  //     ancestor of that (known-nearby) label containing a match — needed
  //     once more than one <select> on the page can share the same option
  //     value, or
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
  // The real site's internal value for "Fill Blank" (Numerical questions).
  const FILL_BLANK_OPTION_VALUE = "fill_blank";

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
      //
      // REVISED (multi-question bug, live-diagnosed): after the first
      // question is saved, a page-level filter control appears elsewhere on
      // the page that also contains option[value="single_choice"] (its own
      // options include "All Types" and "Question Group", neither of which
      // exist in this dialog). An unscoped document-wide search would match
      // whichever one comes first in the DOM once both exist. Scoped via
      // nearLabel to "Marks" — already verified (Phase 7) to exist only
      // inside this dialog — so the search never reaches far enough up the
      // tree to see the unrelated filter control.
      questionTypeDropdown: { optionValueParent: MCQ_OPTION_VALUE, nearLabel: "Marks" },
      mcqOptionValue: MCQ_OPTION_VALUE,
      fillBlankOptionValue: FILL_BLANK_OPTION_VALUE,
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
    addTags: {
      // The input has no id/name/aria-label — only a placeholder — and
      // shares its container with an (unrelated, always-empty) datalist.
      // Scoped via the field's own label text, same {labelText, find}
      // pattern used for Marks/Penalty, to stay safe if a similarly
      // placeholder'd input ever appears elsewhere on the page.
      tagInput: { labelText: "Tags & Sub Tags", find: 'input[placeholder="Add tag..."]' },
      // No id/data-testid/aria-label — only Tailwind utility classes, same
      // pattern as "Add Question" / "Generate with AI" / "Save Question".
      // A single page-level control, safe to match on visible text unscoped.
      addTagButton: { tag: "button", text: "+ Tag" },
    },
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
    // The site's own correct-answer value for each option letter — a native
    // <select>, 0-indexed ("0" -> Option 1 ... "3" -> Option 4). Distinct
    // from optionNumberByLetter (1-indexed, used for label text) since these
    // serve different purposes and shouldn't be conflated.
    correctAnswerValueByLetter: { A: "0", B: "1", C: "2", D: "3" },
    markCorrect: {
      // VERIFIED (Phase 10): native <select>, label and select are direct
      // siblings — same simple pattern as Marks/Penalty, no ancestor walk
      // needed. Chosen over the per-option "Mark as Correct" buttons
      // (which have no stable attribute and would need per-option scoping
      // like Phase 9's markdown button) per explicit direction.
      correctAnswerDropdown: { labelText: "Select Correct Answer" },
    },
    generateAi: {
      // VERIFIED (Phase 11): no id/data-testid/aria-label — only Tailwind
      // utility classes, same pattern as "Add Question". Unlike the
      // Markdown toolbar buttons, this is a single page-level action
      // button (not repeated per field), so its visible text is safe to
      // match unscoped.
      generateButton: { tag: "button", text: "Generate with AI" },
      // Intentionally left as a placeholder — Phase 11 does not wait for
      // or detect generation progress, per explicit scope.
      generationInProgressIndicator: '[data-testid="ai-generation-in-progress"]',
    },
    save: {
      // VERIFIED (Phase 12): no id/data-testid/aria-label — only Tailwind
      // utility classes, same pattern as "Add Question" and "Generate with
      // AI". A single page-level action button, safe to match on visible
      // text unscoped.
      saveButton: { tag: "button", text: "Save Question" },
      // Intentionally left as placeholders — Phase 12 does not wait for the
      // dialog to close or verify question creation, per explicit scope.
      saveDialog: '[data-testid="save-question-dialog"]',
      questionCreatedConfirmation: '[data-testid="question-created-confirmation"]',
    },
    // VERIFIED (Phase 13, against the DOM export in samples/dom.rtf) — the
    // site's native Question Group flow: one shared Instruction/Title
    // editor plus any number of "Sub Question" cards, saved once as a
    // whole. Uploader-only concept: nothing here is exported past this
    // file — Session/parser only ever deal in the paper's own question
    // numbers, never the site's "Sub Question a/b" labels.
    //
    // Deliberately reuses every other selector group above unchanged
    // (prepareForm, pasteQuestion, pasteOptions, markCorrect, generateAi,
    // addTags) — the DOM export confirms each Sub Question card contains
    // the exact same labeled fields (Question Type, Difficulty, Marks,
    // Penalty, Question Text *, Options 1-4, Select Correct Answer,
    // Explanation, Tags & Sub Tags, Generate with AI) as the standalone
    // Add Question form. Only the `root` passed to DomHelpers needs to
    // change (to a specific card's own element instead of `document`) —
    // no new field-level selectors are needed for them.
    questionGroup: {
      // VERIFIED: no id/data-testid/aria-label — only Tailwind utility
      // classes, same pattern as "Add Question". Distinct visible text
      // from "Add Question" ("Add Question Group"), so matching by text is
      // unambiguous even with both buttons present on the same page.
      addQuestionGroupButton: { tag: "button", text: "Add Question Group" },
      // VERIFIED: same label+required-marker shape as "Question Text *"
      // (a trailing "<span>*</span>" with one space before it, giving a
      // trimmed textContent of "Instruction / Title *") — reuses the exact
      // {labelText, find} pattern already proven for pasteQuestion, and
      // the same shared markdownImportModal. This editor is always at the
      // group level (unscoped / document root) — it has no per-card
      // equivalent, since the whole point is one shared block for every
      // Sub Question in the group.
      instructionMarkdownButton: { labelText: "Instruction / Title *", find: 'button[aria-label="Paste Raw Markdown"]' },
      // VERIFIED: no id/data-testid/aria-label — only Tailwind utility
      // classes, same pattern as "Add Question Group". A single
      // page-level action within the group form (not repeated per card),
      // so an unscoped text match is safe.
      addSubQuestionButton: { tag: "button", text: "Add Sub Question" },
      // VERIFIED: each Sub Question card is a collapsible accordion whose
      // only stable identifier is its own <h4> heading text — the site
      // assigns sequential letters itself ("Sub Question a", "Sub Question
      // b", ...) as each card is added, confirmed identical in both the
      // collapsed and expanded DOM captures. `closest` walks up from that
      // heading to the smallest ancestor carrying both "rounded-xl" and
      // "overflow-hidden" (the card's own root container, 3 levels up in
      // the export but closest() doesn't depend on that exact depth).
      // Safe despite those being shared, non-unique Tailwind classes:
      // closest() only walks ancestors of the element already uniquely
      // identified by the heading text, so it can only ever resolve to
      // *this* card's own root, never a different card's, regardless of
      // how many other elements elsewhere in the document happen to share
      // the same two classes. Returns the card root element directly —
      // this is what should be passed as `root` to every reused
      // prepareForm/pasteQuestion/pasteOptions/markCorrect/generateAi/
      // addTags helper call for that sub-question.
      subQuestionCard: (letter) => ({ tag: "h4", text: `Sub Question ${letter}`, closest: ".rounded-xl.overflow-hidden" }),
      // The site's own per-card lettering is 0-indexed from "a" — a fact
      // about the website's own encoding (same category as
      // optionNumberByLetter / correctAnswerValueByLetter above), not
      // something Session or the parser should ever compute or know about.
      // Converts a sub-question's position within its Question Group
      // (0 = first) into the letter subQuestionCard expects.
      subQuestionLetterByPosition: (position) => String.fromCharCode(97 + position),
    },
  };

  window.ExamUploadAssistantSelectors = SELECTORS;
})();
