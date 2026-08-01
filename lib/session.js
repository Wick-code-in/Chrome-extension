(function () {
  let rawMarkdown = null;
  let questions = [];
  let currentQuestionIndex = 0;
  let currentState = "IDLE";
  let examType = null;

  function reset() {
    rawMarkdown = null;
    questions = [];
    currentQuestionIndex = 0;
    currentState = "IDLE";
    examType = null;
  }

  function setExamType(type) {
    examType = type;
  }

  function getExamType() {
    return examType;
  }

  function setRawMarkdown(text) {
    rawMarkdown = text;
  }

  function getRawMarkdown() {
    return rawMarkdown;
  }

  function setQuestions(parsedQuestions) {
    questions = Array.isArray(parsedQuestions) ? parsedQuestions : [];
    currentQuestionIndex = 0;
  }

  function getQuestions() {
    return questions;
  }

  function getTotalQuestions() {
    return questions.length;
  }

  function getCurrentQuestionIndex() {
    return currentQuestionIndex;
  }

  function getCurrentQuestion() {
    return questions[currentQuestionIndex] || null;
  }

  function hasCurrentQuestion() {
    return currentQuestionIndex < questions.length;
  }

  function advanceToNextQuestion() {
    currentQuestionIndex += 1;
  }

  function setCurrentQuestionIndex(index) {
    currentQuestionIndex = index;
  }

  function getCurrentState() {
    return currentState;
  }

  function setCurrentState(state) {
    currentState = state;
  }

  window.ExamUploadAssistantSession = {
    reset,
    setRawMarkdown,
    getRawMarkdown,
    setExamType,
    getExamType,
    setQuestions,
    getQuestions,
    getTotalQuestions,
    getCurrentQuestionIndex,
    getCurrentQuestion,
    hasCurrentQuestion,
    advanceToNextQuestion,
    setCurrentQuestionIndex,
    getCurrentState,
    setCurrentState,
  };
})();
