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
    // VERIFIED live (2026-08-06, PASTE_OPTIONS reconnaissance).
    pasteOptions: {
      // VERIFIED: the number of option cards present when PASTE_OPTIONS
      // runs is NOT a fixed default — Docxsity's Question Type control
      // itself resizes the underlying options array whenever it's actively
      // selected (confirmed live 2026-08-06: selecting "Fill Blank" via a
      // real click collapses option cards to 0; selecting "MCQ Choice" back
      // populates exactly 4 empty cards; both directions immediate, no
      // timing gap, never restores prior content). Since selectDropdown()
      // is idempotent (only performs a real click when the ng-select's
      // current value differs from the target), whether this has already
      // fired by the time PASTE_OPTIONS runs depends on the Add Question
      // modal's accumulated Question Type interaction history for that
      // session — 1 card (Question Type never actively touched) and 4
      // cards (it was) have both been observed live, and ensureOptionCount
      // below is written to handle either starting point correctly by
      // construction: check each position, click "Add Option" once and
      // wait for that specific next card only when it's actually missing,
      // never clicking ahead of what's been observed. <button class="btn
      // ...">"+ Add Option" as rendered, but the "+" is a separate icon
      // element with no text node — textContent trims to exactly
      // "Add Option".
      addOptionButton: { tag: "button", text: "Add Option" },
      // VERIFIED (re-checked live per explicit request, not assumed): zero
      // <label> elements exist anywhere in the options section — the Add
      // Question modal has 9 real <label>s total (Question Type,
      // Difficulty, Marks, Penalty, Question Text, Tags, ...), none reading
      // "Option N". {labelText} cannot resolve these, unlike every other
      // field on the form. Resolves to the option's own .qm-option-card
      // root via its <span class="qm-option-label"> heading + closest() —
      // the same {tag,text,closest} pattern Modality uses for its Sub
      // Question cards. Chosen over a positional :nth-of-type(N) selector:
      // both resolve to the identical element today (the options
      // container's only children are .qm-option-card divs, confirmed
      // live), but this one doesn't depend on that sibling-type purity
      // holding forever, and reuses an existing selector capability rather
      // than introducing a new one.
      optionCard: (number) => ({ tag: "span", text: `Option ${number}`, closest: ".qm-option-card" }),
      // VERIFIED: identical button (aria-label="Paste Raw Markdown", same
      // classes) to Question Text's — found via a plain selector scoped to
      // the option's own card (the resolved element from optionCard
      // above), the second half of the same two-step root-then-field
      // pattern, not a fresh {labelText} descriptor since there's no label
      // to anchor to here.
      markdownButtonSelector: 'button[aria-label="Paste Raw Markdown"]',
      // Docxsity's own per-card lettering — mirrors Modality's identical
      // optionNumberByLetter mapping (a fact about the site's own UI
      // numbering, not shared with or derived from it).
      optionNumberByLetter: { A: 1, B: 2, C: 3, D: 4 },
    },
    // VERIFIED live (2026-08-06, MARK_CORRECT reconnaissance). A separate
    // "Select Correct Answer" summary control also exists (bidirectionally
    // synced with the button below), but is deliberately NOT automated: its
    // control type differs by context (a native <select> in the standalone
    // form, an <ng-select> inside a Sub Question card — confirmed both
    // live), whereas the per-option button is identical in both contexts.
    markCorrect: {
      // VERIFIED: <button class="qm-correct-btn">Mark as Correct</button>,
      // one per option card, found via a plain selector scoped to the
      // option's own card (the resolved element from pasteOptions.optionCard
      // above) — same two-step root-then-field pattern as the option's
      // markdown button, no new lookup strategy needed.
      correctButtonSelector: "button.qm-correct-btn",
      // VERIFIED: this exact class is added to the clicked button (and only
      // that button — confirmed live that selecting a different option
      // moves it, never leaves two active at once) the moment it's marked
      // correct. No aria-pressed or other attribute is used — class is the
      // only observable state.
      activeButtonClass: "qm-correct-btn--active",
    },
    // VERIFIED live (2026-08-06, GENERATE_AI reconnaissance) — including one
    // real end-to-end generation, not just structural inspection.
    generateAi: {
      // VERIFIED: <button class="qm-btn-generate-ai">Generate with AI</button>,
      // always present and enabled regardless of field completion or
      // Question Type (confirmed for MCQ Choice, Fill Blank, the standalone
      // form, and inside a Sub Question card). Its own visible text swaps
      // to "Generating..." while a `disabled` attribute is present, so this
      // deliberately targets the stable class rather than {tag,text} — a
      // text-based lookup would stop matching the instant generation starts.
      generateButtonSelector: "button.qm-btn-generate-ai",
      // VERIFIED: the AI model picker (<app-multi-models>, a custom
      // dropdown — not <select> or <ng-select>) exists on the standalone
      // form too, always defaults to "Default" pre-selected, no manual
      // interaction required. Deliberately not automated — left untouched
      // per explicit direction.
      //
      // VERIFIED: before any content exists, Explanation is just a
      // <label>Explanation <span class="qm-optional">(Optional)</span></label>
      // + a hint <p> ("Add an explanation manually or generate one using
      // AI.") — no editor at all. After a real generation, the same
      // container instead renders a full TinyMCE <app-rich-editor> with the
      // generated content (directly observed on a completed generation:
      // Topic / Correct Answer / Short Explanation / Why the Other Options
      // Are Incorrect). Resolves via the same {labelText, find} pattern
      // used elsewhere — label's exact trimmed text is "Explanation
      // (Optional)" (the "(Optional)" is a nested span, but textContent
      // still trims to one string).
      explanationEditor: { labelText: "Explanation (Optional)", find: "app-rich-editor" },
    },
    // VERIFIED live (2026-08-06, ADD_TAGS reconnaissance) — added a real
    // tag and inspected the resulting structure, not just the empty state.
    addTags: {
      // VERIFIED: <div class="tib-wrapper"><label class="tib-label"> Tags &
      // Sub Tags </label>...<input class="tib-input" placeholder="Add
      // tag..."></div>. The label's raw textContent has surrounding
      // whitespace (" Tags & Sub Tags ") — {labelText} trims before
      // comparing, so "Tags & Sub Tags" still matches correctly. Only one
      // input exists — Subject Tags and Sub Tags are NOT separate controls,
      // see tagPill below for how the hierarchy actually works.
      tagInput: { labelText: "Tags & Sub Tags", find: "input.tib-input" },
      // VERIFIED: <button class="tib-add-btn">+ Tag</button>, a single
      // instance per modal (standalone form) — safe to match by text alone,
      // same pattern as other single-instance action buttons
      // (Render & Insert, Save Question).
      addTagButton: { tag: "button", text: "+ Tag" },
      // VERIFIED: once added, a tag renders as <span
      // class="tib-tag-pill">{subject}</span> inside a new .tib-tag-block,
      // sibling to a <button class="tib-remove-tag-btn">Remove</button> and
      // a "+ Sub Tag" button (both deliberately never touched — no sub-tag
      // data exists in the parsed Question Object, and Remove is obviously
      // destructive). The pill's own trimmed text is exactly the tag value
      // and nothing else, so {tag:"span", text: subject} alone is a
      // complete completion signal — no closest() walk needed.
      tagPill: (subject) => ({ tag: "span", text: subject }),
    },
    // VERIFIED live (2026-08-06, SAVE reconnaissance) — including one real
    // save (explicit user go-ahead) and one real validation-failure test.
    save: {
      // VERIFIED: <button class="wm-btn wm-sm-btn ..." type="button">Save
      // Question</button> — not a native form submit, a click handler like
      // everything else. Same button text also exists inside the Add
      // Question Group modal, but Question Groups are out of scope — this
      // selector is only ever used scoped to the standalone Add Question
      // modal root.
      saveButton: { tag: "button", text: "Save Question" },
      // VERIFIED: on a validation failure (tested live with an empty form),
      // the modal does NOT close, and inline messages appear as elements
      // with this exact class — one per invalid field ("Question text is
      // required.", "Option text is required." x4, "Please select a
      // correct answer."). Used only to build an actionable failure
      // message after the completion-signal wait times out — never the
      // wait condition itself.
      validationErrorSelector: ".qm-error",
    },
  };

  window.ExamUploadAssistantSelectors = SELECTORS;
})();
