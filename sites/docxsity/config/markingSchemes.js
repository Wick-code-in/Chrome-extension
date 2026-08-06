(function () {
  // Docxsity-owned marking-scheme configuration — separated from
  // stateMachine.js so PREPARE_FORM only ever asks "what marks/penalty
  // apply to this exam" rather than containing exam-specific constants
  // itself. Keyed by the exact examType strings lib/parser.js's
  // detectExamType() produces (see Session.getExamType()), not an invented
  // namespace — "JEE", "UPSC_PAPER_I", "UPSC_PAPER_II".
  //
  // INTENTIONAL DUPLICATION: these values currently duplicate the ones
  // hardcoded inside sites/modality/stateMachine.js
  // (PREPARE_FORM_MARKS_VALUE, PREPARE_FORM_PENALTY_VALUE,
  // MARKS_PENALTY_BY_UPSC_PAPER). Marking schemes are business logic, not
  // website logic, and would ideally live in one shared place — but
  // migrating Modality onto a shared config is explicitly out of scope for
  // Docxsity V2 (sites/modality/* stays untouched). Until that dedicated
  // migration happens, keep these two tables in sync by hand whenever a
  // scheme changes (e.g. a new UPSC cycle's marking rules).
  const MARKING_SCHEMES = {
    JEE: { marks: "4", penalty: "1" },
    UPSC_PAPER_I: { marks: "2", penalty: "0.66" },
    UPSC_PAPER_II: { marks: "2.5", penalty: "0.83" },
  };

  // Fails closed: an exam type with no entry here returns null rather than
  // guessing or falling back to another exam's scheme — mirrors this
  // project's existing "unrecognized exam yields nothing, never a guess"
  // convention (detectExamType() in lib/parser.js).
  function getMarkingScheme(examType) {
    return MARKING_SCHEMES[examType] || null;
  }

  window.ExamUploadAssistantMarkingSchemes = {
    getMarkingScheme,
  };
})();
