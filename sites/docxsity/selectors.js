(function () {
  // The only file that may hardcode a Docxsity selector. Same descriptor
  // shapes as sites/modality/selectors.js ({tag,text,closest} /
  // {labelText,find}), consumed by this site's own domHelpers.js — nothing
  // here is shared with or derived from Modality's selectors.
  //
  // Everything below is VERIFIED live against https://www.docxsity.com/
  // (2026-08-06, Phase 1/2), not inferred from the reverted
  // docxsity-experiment branch's static DOM export. Only fields PREPARE_FORM
  // actually needs are populated — later phases add their own sections here
  // as each is itself live-verified, per the project's incremental,
  // one-phase-at-a-time discipline.

  const MCQ_OPTION_VALUE = "MCQ Choice";
  // VERIFIED: the reverted branch's guess for this ("Numerical") was wrong —
  // the live Question Type ng-select's real 5 options are "MCQ Choice",
  // "True False", "Short Answer", "Long Answer", "Fill Blank".
  const FILL_BLANK_OPTION_VALUE = "Fill Blank";

  const SELECTORS = {
    // VERIFIED: clicking "Add Question" opens an ng-bootstrap modal
    // (<ngb-modal-window role="dialog">), not an inline form — the reverted
    // branch's static export never captured this. Every field below must be
    // resolved relative to this modal's root, not document, per the
    // project's modal-root-once convention: click Add Question, wait for
    // this selector, then scope every subsequent lookup for the workflow to
    // the element it resolves to.
    addQuestionModal: { tag: "h2", text: "Add Question", closest: "ngb-modal-window" },
    prepareForm: {
      // VERIFIED: <button class="aq-btn-add ... wm-btn wm-sm-btn">, visible
      // text "Add Question" (icon has no text node, textContent trims clean).
      addQuestionButton: { tag: "button", text: "Add Question" },
      // VERIFIED: an <ng-select> (class "qm-select ng-select ng-select-single"),
      // not a native <select>. Its currently-selected label renders inside a
      // child .ng-value element — read by DomHelpers' ng-select strategy.
      // Defaults to "MCQ Choice" the moment the modal opens.
      questionTypeDropdown: { labelText: "Question Type", find: "ng-select" },
      mcqOptionValue: MCQ_OPTION_VALUE,
      fillBlankOptionValue: FILL_BLANK_OPTION_VALUE,
      // VERIFIED: native <input type="number" min="1" placeholder="e.g. 5">,
      // sibling of its <label> inside one shared container div — the
      // {labelText} pattern resolves it with no ancestor walk needed.
      // Defaults to "1" the moment the modal opens (still written
      // explicitly, same as Modality does for its own Marks field).
      marksInput: { labelText: "Marks" },
      // VERIFIED: same shape as Marks (<input type="number" min="0"
      // step="any" placeholder="e.g. 1.25">). Unlike Modality — which skips
      // Penalty entirely for its non-MCQ question type — Docxsity's Penalty
      // field stays present and enabled regardless of Question Type
      // (confirmed by live-selecting "Fill Blank" and re-checking the
      // field), so runPrepareForm fills it unconditionally for every type.
      penaltyInput: { labelText: "Penalty" },
    },
    // VERIFIED live (2026-08-06, PASTE_QUESTION reconnaissance): the trigger
    // button is scoped inside the Add Question modal, same as prepareForm's
    // fields — but everything below (markdownImportModal) is NOT, see there.
    pasteQuestion: {
      // VERIFIED: <button class="tox-tbtn tox-tbtn--select" aria-label="Paste
      // Raw Markdown">, visible text "Markdown" next to an icon (Modality's
      // equivalent is icon-only — cosmetic difference only, same aria-label
      // and same {labelText, find} resolution path). The "--select" class
      // suggests a dropdown-type TinyMCE toolbar button, but a plain click()
      // opens the import dialog directly — no submenu appears in practice.
      markdownButton: { labelText: "Question Text *", find: 'button[aria-label="Paste Raw Markdown"]' },
    },
    // VERIFIED live: unlike every field above, this dialog is NOT a
    // descendant of the Add Question <ngb-modal-window> — it's TinyMCE's own
    // native dialog, appended directly to document.body as a sibling of the
    // modal (inside a .tox-dialog-wrap). Confirmed by
    // ngbModalWindow.contains(dialogElement) === false. This means: click
    // the trigger button scoped to the Add Question modal root, then
    // deliberately switch to document scope (root omitted / undefined) for
    // every lookup below — never keep searching inside the Add Question
    // modal for these three.
    markdownImportModal: {
      // VERIFIED: the dialog carries its own aria-label directly
      // (<div role="dialog" aria-label="Paste Markdown Data"
      // class="tox-dialog tox-dialog--width-lg">) — a plain attribute
      // selector, simpler and more robust than matching by title text +
      // closest() (which sites/modality/selectors.js has to do, since its
      // dialog apparently lacks this direct aria-label).
      container: '[role="dialog"][aria-label="Paste Markdown Data"]',
      // VERIFIED: has a real <label>Raw Markdown</label> directly above the
      // textarea — the {labelText} pattern resolves it same as every other
      // labeled field.
      rawMarkdownTextarea: { labelText: "Raw Markdown" },
      // VERIFIED: <button class="tox-button">Render & Insert</button>.
      renderAndInsertButton: { tag: "button", text: "Render & Insert" },
    },
  };

  window.ExamUploadAssistantSelectors = SELECTORS;
})();
