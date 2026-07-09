(function () {
  function loadStyles(shadowRoot) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("content/panel.css");
    shadowRoot.appendChild(link);
  }

  function buildMarkup(shadowRoot) {
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
      <div class="panel-header" data-field="header">Exam Upload Assistant</div>
      <button type="button" class="panel-load-button" data-field="load-button">Load Markdown</button>
      <div class="panel-row">
        <span class="panel-label">File</span>
        <span class="panel-value" data-field="filename">No file loaded</span>
      </div>
      <div class="panel-row">
        <span class="panel-label">Question</span>
        <span class="panel-value" data-field="question-counter">0 / 0</span>
      </div>
      <div class="panel-row">
        <span class="panel-label">State</span>
        <span class="panel-value" data-field="current-state">IDLE</span>
      </div>
      <button type="button" class="panel-execute-button" data-field="execute-button">Execute Step</button>
      <button type="button" class="panel-pass-button" data-field="pass-button">Pass Step</button>
      <div class="panel-jump-row">
        <input type="text" inputmode="numeric" class="panel-jump-input" data-field="jump-input" placeholder="Question #" />
        <button type="button" class="panel-jump-button" data-field="jump-button">Jump</button>
      </div>
      <div class="panel-row">
        <span class="panel-label">Status</span>
        <span class="panel-value" data-field="status">Ready</span>
      </div>
      <div class="panel-progress-track">
        <div class="panel-progress-fill" data-field="progress-fill"></div>
      </div>
    `;
    shadowRoot.appendChild(panel);
    return panel;
  }

  function makeDraggable(panelEl, handleEl) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handleEl.addEventListener("mousedown", (event) => {
      dragging = true;
      const rect = panelEl.getBoundingClientRect();
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      panelEl.style.right = "auto";
      panelEl.style.left = rect.left + "px";
      panelEl.style.top = rect.top + "px";
    });

    document.addEventListener("mousemove", (event) => {
      if (!dragging) {
        return;
      }
      panelEl.style.left = event.clientX - offsetX + "px";
      panelEl.style.top = event.clientY - offsetY + "px";
    });

    document.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  function create(shadowRoot) {
    loadStyles(shadowRoot);
    const panelEl = buildMarkup(shadowRoot);

    const questionCounterEl = panelEl.querySelector('[data-field="question-counter"]');
    const currentStateEl = panelEl.querySelector('[data-field="current-state"]');
    const statusEl = panelEl.querySelector('[data-field="status"]');
    const progressFillEl = panelEl.querySelector('[data-field="progress-fill"]');
    const executeButtonEl = panelEl.querySelector('[data-field="execute-button"]');
    const passButtonEl = panelEl.querySelector('[data-field="pass-button"]');
    const jumpInputEl = panelEl.querySelector('[data-field="jump-input"]');
    const jumpButtonEl = panelEl.querySelector('[data-field="jump-button"]');
    const headerEl = panelEl.querySelector('[data-field="header"]');
    const loadButtonEl = panelEl.querySelector('[data-field="load-button"]');
    const filenameEl = panelEl.querySelector('[data-field="filename"]');

    const api = {
      setQuestionCounter(text) {
        questionCounterEl.textContent = text;
      },
      setCurrentState(text) {
        currentStateEl.textContent = text;
      },
      setStatus(text) {
        statusEl.textContent = text;
      },
      setProgress(percent) {
        const clamped = Math.max(0, Math.min(100, percent));
        progressFillEl.style.width = clamped + "%";
      },
    };

    function refreshFromSession(result) {
      const session = window.ExamUploadAssistantSession;

      const total = session.getTotalQuestions();
      const displayIndex = Math.min(session.getCurrentQuestionIndex() + 1, total);
      const progressPercent = total > 0 ? (session.getCurrentQuestionIndex() / total) * 100 : 0;

      api.setStatus(result.message);
      api.setCurrentState(session.getCurrentState());
      api.setQuestionCounter(`${displayIndex} / ${total}`);
      api.setProgress(progressPercent);
    }

    executeButtonEl.addEventListener("click", async () => {
      const result = await window.ExamUploadAssistantStateMachine.executeStep();
      refreshFromSession(result);
    });

    passButtonEl.addEventListener("click", () => {
      const result = window.ExamUploadAssistantStateMachine.passStep();
      refreshFromSession(result);
    });

    jumpButtonEl.addEventListener("click", () => {
      const result = window.ExamUploadAssistantStateMachine.jumpToQuestion(jumpInputEl.value);
      refreshFromSession(result);

      if (result.success) {
        jumpInputEl.value = "";
      }
    });

    loadButtonEl.addEventListener("click", () => {
      window.ExamUploadAssistantLoader.openFilePicker((result) => {
        api.setStatus(result.message);

        if (!result.success) {
          return;
        }

        filenameEl.textContent = result.filename;

        const session = window.ExamUploadAssistantSession;
        const rawMarkdown = window.ExamUploadAssistantLoader.getRawMarkdown();
        const questions = window.ExamUploadAssistantParser.parse(rawMarkdown);

        session.setRawMarkdown(rawMarkdown);
        session.setQuestions(questions);
        session.setCurrentState("IDLE");

        const total = session.getTotalQuestions();
        const displayIndex = total > 0 ? 1 : 0;

        api.setQuestionCounter(`${displayIndex} / ${total}`);
        api.setCurrentState(session.getCurrentState());
        api.setProgress(0);
      });
    });

    makeDraggable(panelEl, headerEl);

    window.ExamUploadAssistantPanel.api = api;
    return api;
  }

  window.ExamUploadAssistantPanel = { create };
})();
