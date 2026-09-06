(function () {
  // Extension-wide, temporary Settings state — genuinely shared, the same
  // way lib/session.js is: an in-memory module scope, exposed on `window`,
  // that resets for free whenever a content script is reinjected (page
  // reload, extension reload). No persistence mechanism is used or needed —
  // that reset-on-reinjection behavior is the entire "non-persistent by
  // construction" story, exactly as it already is for Session.
  //
  // Knows nothing about exam type, Question Groups, or which site is
  // running it — every getter/setter here is pure state, and
  // resolveEffectiveMarks/resolveEffectivePenalty take a paper default in
  // and hand an effective value (or a failure) back out. Each site's own
  // stateMachine.js decides when to call these and what to do with the
  // result — this file never touches the DOM or Session.
  let marksOverrideEnabled = false;
  let marksOverrideValue = "";
  let penaltyOverrideEnabled = false;
  let penaltyOverrideValue = "";

  let selectCorrectOptionEnabled = true;
  let generateAiEnabled = true;
  let tagsEnabled = true;

  function getMarksOverride() {
    return { enabled: marksOverrideEnabled, value: marksOverrideValue };
  }

  function setMarksEnabled(enabled) {
    marksOverrideEnabled = !!enabled;
  }

  function setMarksValue(value) {
    marksOverrideValue = value;
  }

  function getPenaltyOverride() {
    return { enabled: penaltyOverrideEnabled, value: penaltyOverrideValue };
  }

  function setPenaltyEnabled(enabled) {
    penaltyOverrideEnabled = !!enabled;
  }

  function setPenaltyValue(value) {
    penaltyOverrideValue = value;
  }

  function isSelectCorrectOptionEnabled() {
    return selectCorrectOptionEnabled;
  }

  function setSelectCorrectOptionEnabled(enabled) {
    selectCorrectOptionEnabled = !!enabled;
  }

  function isGenerateAiEnabled() {
    return generateAiEnabled;
  }

  function setGenerateAiEnabled(enabled) {
    generateAiEnabled = !!enabled;
  }

  function isTagsEnabled() {
    return tagsEnabled;
  }

  function setTagsEnabled(enabled) {
    tagsEnabled = !!enabled;
  }

  // The override toggle is authoritative, per the project's own fail-closed
  // convention (mirrors getMarkingScheme()'s null-on-unconfigured rather
  // than guessing): OFF always returns the paper default, unconditionally.
  // ON returns the entered value only if it's actually a usable number —
  // an enabled override with an empty/non-numeric value must not silently
  // fall back to the paper default (that would make the toggle a
  // suggestion, not a switch) and must not be handed to a site's fillInput
  // as-is (that would write garbage into a live Marks/Penalty field).
  function resolveEffectiveValue(override, paperDefaultValue, label) {
    if (!override.enabled) {
      return { success: true, value: paperDefaultValue };
    }

    const trimmed = typeof override.value === "string" ? override.value.trim() : "";

    if (trimmed === "" || Number.isNaN(Number(trimmed))) {
      return {
        success: false,
        message: `${label} Override is enabled in Settings, but the value isn't a valid number. Open Settings and enter a valid ${label} value, or turn the override off to use the paper default.`,
        retryable: false,
      };
    }

    return { success: true, value: trimmed };
  }

  function resolveEffectiveMarks(paperDefaultValue) {
    return resolveEffectiveValue(getMarksOverride(), paperDefaultValue, "Marks");
  }

  function resolveEffectivePenalty(paperDefaultValue) {
    return resolveEffectiveValue(getPenaltyOverride(), paperDefaultValue, "Penalty");
  }

  window.ExamUploadAssistantSettings = {
    getMarksOverride,
    setMarksEnabled,
    setMarksValue,
    getPenaltyOverride,
    setPenaltyEnabled,
    setPenaltyValue,
    isSelectCorrectOptionEnabled,
    setSelectCorrectOptionEnabled,
    isGenerateAiEnabled,
    setGenerateAiEnabled,
    isTagsEnabled,
    setTagsEnabled,
    resolveEffectiveMarks,
    resolveEffectivePenalty,
  };
})();
