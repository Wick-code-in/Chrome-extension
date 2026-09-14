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
    NDA_MATHEMATICS: { marks: "2.5", penalty: "0.83" },
    NDA_GAT: { marks: "4", penalty: "1.33" },
    // CAT is the first exam type whose marking scheme varies by question
    // type WITHIN the same paper (MCQ vs NUMERICAL/TITA can appear
    // intermixed, even within one Question Group) rather than being one
    // flat {marks, penalty} pair for the whole exam — see getMarkingScheme
    // below for how this entry's different shape is resolved.
    CAT: {
      MCQ: { marks: "3", penalty: "1" },
      NUMERICAL: { marks: "3", penalty: "0" },
    },
  };

  // Fails closed: an exam type with no entry here returns null rather than
  // guessing or falling back to another exam's scheme — mirrors this
  // project's existing "unrecognized exam yields nothing, never a guess"
  // convention (detectExamType() in lib/parser.js).
  //
  // `questionType` is optional and purely additive: every entry above
  // except CAT's is a flat {marks, penalty} pair with no `.MCQ`/`.NUMERICAL`
  // keys, so `entry.MCQ || entry.NUMERICAL` is false for all of them and
  // `return entry` (unchanged, exactly as before this parameter was added)
  // is what every other exam type's lookup still resolves to, regardless of
  // what — if anything — is passed as questionType. Only CAT's own entry is
  // itself keyed by question type, so only a CAT lookup ever takes the
  // type-keyed branch below.
  function getMarkingScheme(examType, questionType) {
    const entry = MARKING_SCHEMES[examType];

    if (!entry) {
      return null;
    }

    if (entry.MCQ || entry.NUMERICAL) {
      return entry[questionType] || null;
    }

    return entry;
  }

  window.ExamUploadAssistantMarkingSchemes = {
    getMarkingScheme,
  };
})();
