(function () {
  function loadStyles(shadowRoot) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("content/panel.css");
    shadowRoot.appendChild(link);
  }

  // Docxsity (slideshowSupported: true) repurposes the header into the Load
  // Markdown control and adds a Play/Pause row after State; Modality
  // (slideshowSupported: false) keeps its original title + standalone Load
  // Markdown row, completely unchanged, with no Play/Pause row at all. This
  // is the ONLY place either site's panel structure diverges — driven
  // purely by the state machine's own supportsSlideshow capability flag
  // (see sites/docxsity/stateMachine.js / sites/modality/stateMachine.js),
  // never by a hostname/site check. Every element keeps the same
  // data-field attribute regardless of which branch produced it, so
  // nothing downstream in create() needs to know or care which layout is
  // in use.
  function buildMarkup(shadowRoot, slideshowSupported) {
    const panel = document.createElement("div");
    panel.className = "panel";

    const headerContent = slideshowSupported
      ? `<button type="button" class="panel-load-button panel-header-load-button" data-field="load-button">Load Markdown</button>`
      : `<span class="panel-header-title">Exam Upload Assistant</span>`;

    const standaloneLoadButton = slideshowSupported
      ? ""
      : `<button type="button" class="panel-load-button" data-field="load-button">Load Markdown</button>`;

    // Play/Pause deliberately reuse .panel-execute-button/.panel-pass-button
    // for color/border/typography (same visual role: Play is the primary
    // "go" action like Execute, Pause is the secondary/stopping action like
    // Pass) plus a small sizing modifier class so they sit side by side in
    // the existing .panel-jump-row two-column flex pattern instead of full
    // width. See content/panel.css.
    const slideshowRow = slideshowSupported
      ? `<div class="panel-jump-row">
          <button type="button" class="panel-execute-button panel-play-button" data-field="play-button">Play</button>
          <button type="button" class="panel-pass-button panel-pause-button" data-field="pause-button">Pause</button>
        </div>`
      : "";

    panel.innerHTML = `
      <div class="panel-header" data-field="header">
        ${headerContent}
        <button type="button" class="panel-settings-toggle" data-field="settings-open-button" title="Settings">&#9881;</button>
      </div>
      <div class="panel-main-view" data-field="main-view">
        ${standaloneLoadButton}
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
        ${slideshowRow}
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
      </div>
      <div class="panel-settings-view" data-field="settings-view" hidden>
        <div class="panel-settings-header">
          <button type="button" class="panel-settings-back" data-field="settings-back-button">&larr; Back</button>
          <span class="panel-settings-title">Settings</span>
        </div>
        <div class="panel-row">
          <span class="panel-label">Marks</span>
          <button type="button" class="panel-toggle-button" data-field="marks-override-toggle">OFF</button>
        </div>
        <input type="text" inputmode="decimal" class="panel-jump-input panel-settings-input" data-field="marks-override-input" placeholder="Marks value" disabled />
        <div class="panel-row">
          <span class="panel-label">Penalty</span>
          <button type="button" class="panel-toggle-button" data-field="penalty-override-toggle">OFF</button>
        </div>
        <input type="text" inputmode="decimal" class="panel-jump-input panel-settings-input" data-field="penalty-override-input" placeholder="Penalty value" disabled />
        <div class="panel-row">
          <span class="panel-label">Select Correct Option</span>
          <button type="button" class="panel-toggle-button" data-field="select-correct-toggle">ON</button>
        </div>
        <div class="panel-row">
          <span class="panel-label">Generate with AI</span>
          <button type="button" class="panel-toggle-button" data-field="generate-ai-toggle">ON</button>
        </div>
        <div class="panel-row">
          <span class="panel-label">Tags</span>
          <button type="button" class="panel-toggle-button" data-field="tags-toggle">ON</button>
        </div>
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

    // Read once, at construction time, from the state machine's own
    // capability flag — never from a hostname/site check. The site cannot
    // change without a full page navigation (which destroys and recreates
    // this whole content-script context anyway), so a one-time read here
    // is sufficient, matching how Session/Settings already assume a fresh
    // module scope per page load.
    const slideshowSupported = !!(
      window.ExamUploadAssistantStateMachine && window.ExamUploadAssistantStateMachine.supportsSlideshow
    );
    const panelEl = buildMarkup(shadowRoot, slideshowSupported);

    const questionCounterEl = panelEl.querySelector('[data-field="question-counter"]');
    const currentStateEl = panelEl.querySelector('[data-field="current-state"]');
    const statusEl = panelEl.querySelector('[data-field="status"]');
    const progressFillEl = panelEl.querySelector('[data-field="progress-fill"]');
    const executeButtonEl = panelEl.querySelector('[data-field="execute-button"]');
    const passButtonEl = panelEl.querySelector('[data-field="pass-button"]');
    const jumpInputEl = panelEl.querySelector('[data-field="jump-input"]');
    const jumpButtonEl = panelEl.querySelector('[data-field="jump-button"]');
    // Absent (null) on Modality, where buildMarkup() never renders them —
    // every reference to these below is guarded accordingly.
    const playButtonEl = panelEl.querySelector('[data-field="play-button"]');
    const pauseButtonEl = panelEl.querySelector('[data-field="pause-button"]');
    const headerEl = panelEl.querySelector('[data-field="header"]');
    const loadButtonEl = panelEl.querySelector('[data-field="load-button"]');
    const filenameEl = panelEl.querySelector('[data-field="filename"]');
    const settingsOpenButtonEl = panelEl.querySelector('[data-field="settings-open-button"]');
    const settingsBackButtonEl = panelEl.querySelector('[data-field="settings-back-button"]');
    const mainViewEl = panelEl.querySelector('[data-field="main-view"]');
    const settingsViewEl = panelEl.querySelector('[data-field="settings-view"]');
    const marksOverrideToggleEl = panelEl.querySelector('[data-field="marks-override-toggle"]');
    const marksOverrideInputEl = panelEl.querySelector('[data-field="marks-override-input"]');
    const penaltyOverrideToggleEl = panelEl.querySelector('[data-field="penalty-override-toggle"]');
    const penaltyOverrideInputEl = panelEl.querySelector('[data-field="penalty-override-input"]');
    const selectCorrectToggleEl = panelEl.querySelector('[data-field="select-correct-toggle"]');
    const generateAiToggleEl = panelEl.querySelector('[data-field="generate-ai-toggle"]');
    const tagsToggleEl = panelEl.querySelector('[data-field="tags-toggle"]');

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

    function currentHasQuestions() {
      return window.ExamUploadAssistantSession.getTotalQuestions() > 0;
    }

    // Single source of truth for every manual control's enabled state,
    // replacing what used to be two separate, duplicated hasQuestions-only
    // blocks (one inline in refreshFromSession, one in the Execute handler's
    // finally safety net). Now also factors in isPanelBusy (previously only
    // enforced imperatively by setPanelBusy/the finally block, never read by
    // refreshFromSession itself) and Slideshow.isRunning(), so that no call
    // to refreshFromSession — including the ones Slideshow's own onStep
    // callback triggers once per automated step — can ever re-enable
    // Execute/Pass/Jump/Load Markdown while a run is in progress. Load
    // Markdown is included here (it never had a guard before this feature):
    // loading a new file mid-run would reset Session out from under the
    // running loop, exactly the same class of risk Execute/Pass/Jump were
    // already protected against.
    //
    // playButtonEl/pauseButtonEl are null on Modality (buildMarkup() never
    // renders them there), so every reference is guarded.
    function applyMainControlsAvailability(hasQuestions) {
      const slideshowRunning = window.ExamUploadAssistantSlideshow.isRunning();
      const notBusy = !isPanelBusy && !slideshowRunning;
      const manualEnabled = hasQuestions && notBusy;

      executeButtonEl.disabled = !manualEnabled;
      passButtonEl.disabled = !manualEnabled;
      jumpInputEl.disabled = !manualEnabled;
      jumpButtonEl.disabled = !manualEnabled;
      // Deliberately NOT gated on hasQuestions, unlike Execute/Pass/Jump —
      // Load Markdown must remain usable before any paper is loaded (that's
      // its entire purpose) as well as after. Only busy/running disables it.
      loadButtonEl.disabled = !notBusy;

      if (playButtonEl) {
        const session = window.ExamUploadAssistantSession;
        // Play is additionally disabled once the paper is COMPLETE — unlike
        // Execute, which stays enabled there today (unchanged, existing
        // behavior) — since pressing Play at that point would just loop on
        // runComplete() with no effect.
        playButtonEl.disabled = !hasQuestions || isPanelBusy || slideshowRunning || session.getCurrentState() === "COMPLETE";
      }

      if (pauseButtonEl) {
        pauseButtonEl.disabled = !slideshowRunning;
      }
    }

    function refreshFromSession(result) {
      const session = window.ExamUploadAssistantSession;

      const total = session.getTotalQuestions();
      const hasQuestions = total > 0;
      const displayIndex = Math.min(session.getCurrentQuestionIndex() + 1, total);
      const progressPercent = total > 0 ? (session.getCurrentQuestionIndex() / total) * 100 : 0;

      api.setStatus(result.message);
      api.setCurrentState(session.getCurrentState());
      api.setQuestionCounter(`${displayIndex} / ${total}`);
      api.setProgress(progressPercent);

      applyMainControlsAvailability(hasQuestions);
      applySettingsAvailability(hasQuestions);
    }

    // Panel-wide busy guard, state-agnostic: executeStep() is async and can
    // be mid-flight for anywhere from milliseconds to tens of seconds (e.g.
    // an AI generation step). Nothing previously stopped Execute Step,
    // Pass Step, or Jump from running again — or from each other — during
    // that window: Session's current state isn't written until the
    // in-flight handler resolves, so a second Execute Step click in that
    // window would read the same state and re-dispatch to the same
    // handler, and Pass Step/Jump would mutate Session concurrently with
    // whatever the in-flight step is still doing against the page. Disabling
    // all four controls synchronously, before the first `await`, closes
    // that window for real clicks (disabled controls don't receive click
    // events); isPanelBusy is kept as the explicit, self-documenting source
    // of truth alongside it, and is checked in every handler as a second,
    // explicit line of defense. Pass Step and Jump are themselves fully
    // synchronous (no `await` in either call chain) and have no
    // re-entrancy problem of their own — this guard exists only to keep
    // them from running concurrently with an in-flight Execute Step. No
    // state-machine or state-handler logic changes — this protects the
    // panel as a whole, for every site and every state equally.
    //
    // Slideshow (see lib/slideshow.js) is a second, independent source of
    // "something is running," covering its own multi-step call path rather
    // than a single click — isPanelBusy and Slideshow.isRunning() are
    // deliberately kept as two separate flags (each guards the call path
    // that sets it) and combined at every checkpoint via
    // applyMainControlsAvailability, rather than merged into one, so
    // neither call path has to know about the other's internals.
    let isPanelBusy = false;

    function setPanelBusy(busy) {
      isPanelBusy = busy;
      applyMainControlsAvailability(currentHasQuestions());
    }

    executeButtonEl.addEventListener("click", async () => {
      if (isPanelBusy || window.ExamUploadAssistantSlideshow.isRunning()) {
        return;
      }

      setPanelBusy(true);

      try {
        const result = await window.ExamUploadAssistantStateMachine.executeStep();
        refreshFromSession(result);
      } finally {
        isPanelBusy = false;
        // Safety net in case refreshFromSession above never ran (e.g. an
        // unexpected rejection) — restore every control to the same
        // availability refreshFromSession would have set, rather than
        // leaving the panel stuck busy.
        applyMainControlsAvailability(currentHasQuestions());
      }
    });

    passButtonEl.addEventListener("click", () => {
      if (isPanelBusy || window.ExamUploadAssistantSlideshow.isRunning()) {
        return;
      }

      const result = window.ExamUploadAssistantStateMachine.passStep();
      refreshFromSession(result);
    });

    jumpButtonEl.addEventListener("click", () => {
      if (isPanelBusy || window.ExamUploadAssistantSlideshow.isRunning()) {
        return;
      }

      const result = window.ExamUploadAssistantStateMachine.jumpToQuestion(jumpInputEl.value);
      refreshFromSession(result);

      if (result.success) {
        jumpInputEl.value = "";
      }
    });

    // The header's own drag handler is registered on headerEl further down
    // (makeDraggable). On Docxsity, Load Markdown now lives inside that same
    // header row — its own mousedown must not also start a drag, the exact
    // same reason the gear icon already stops propagation below. This is a
    // no-op on Modality, where Load Markdown sits in its own row outside the
    // header and was never a drag target to begin with.
    loadButtonEl.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });

    loadButtonEl.addEventListener("click", () => {
      if (isPanelBusy || window.ExamUploadAssistantSlideshow.isRunning()) {
        return;
      }

      window.ExamUploadAssistantLoader.openFilePicker((result) => {
        if (!result.success) {
          api.setStatus(result.message);
          return;
        }

        filenameEl.textContent = result.filename;

        const session = window.ExamUploadAssistantSession;
        const rawMarkdown = window.ExamUploadAssistantLoader.getRawMarkdown();
        const parsed = window.ExamUploadAssistantParser.parseDocument(rawMarkdown);

        session.setRawMarkdown(rawMarkdown);
        session.setExamType(parsed.examType);
        session.setQuestions(parsed.questions);
        session.setCurrentState("IDLE");

        refreshFromSession(result);
      });
    });

    // Slideshow entry point — absent entirely on Modality (playButtonEl/
    // pauseButtonEl are null there), per the state machine's own
    // supportsSlideshow flag. Wiring is skipped entirely rather than
    // attaching dead listeners to non-existent elements.
    if (playButtonEl && pauseButtonEl) {
      playButtonEl.addEventListener("click", () => {
        if (isPanelBusy || window.ExamUploadAssistantSlideshow.isRunning()) {
          return;
        }

        // start() sets Slideshow's internal running flag synchronously,
        // before its first internal await — so by the time this call
        // returns (even though the run itself keeps going asynchronously),
        // applyMainControlsAvailability() below already sees isRunning()
        // as true and locks the panel immediately, without needing to
        // await the whole run from here. onStep/onStopped below are what
        // keep the panel updated for the rest of the run's lifetime.
        window.ExamUploadAssistantSlideshow
          .start({
            onStep(result) {
              refreshFromSession(result);
            },
            onStopped() {
              // Whatever the run's last result was has already been shown
              // via the onStep call above (success, failure, or the final
              // COMPLETE transition) — nothing new to display here, only
              // the controls need to be unlocked now that isRunning() is
              // false again.
              applyMainControlsAvailability(currentHasQuestions());
            },
          })
          .catch(() => {
            // Belt-and-suspenders: lib/slideshow.js already resets its own
            // running flag and calls onStopped in a finally block even on
            // an unexpected rejection, so the panel is never left stuck
            // busy from this alone — this only prevents an unhandled-
            // rejection console warning for something already handled.
          });

        applyMainControlsAvailability(currentHasQuestions());
      });

      pauseButtonEl.addEventListener("click", () => {
        if (!window.ExamUploadAssistantSlideshow.isRunning()) {
          return;
        }

        // Does not cancel whatever step is currently in flight (nothing in
        // this codebase's wait primitives can be interrupted) — only
        // prevents the next one from starting. Disabling Pause immediately
        // (rather than waiting for the run to actually stop) gives honest,
        // instant feedback that a pause is pending; the real final message
        // arrives via the in-flight step's own onStep callback the moment
        // it resolves, overwriting this transient text.
        window.ExamUploadAssistantSlideshow.pause();
        pauseButtonEl.disabled = true;
        api.setStatus("Pausing — finishing current step…");
      });
    }

    // Settings view: a second, initially-hidden sibling of the main view,
    // switched in place inside the same panel — never a separate window,
    // never a resize. No Save button: every control writes straight through
    // to window.ExamUploadAssistantSettings on change, so changes take
    // effect immediately. The gear icon lives inside the draggable header,
    // so its own mousedown must not also start a drag.
    function setToggleButtonState(buttonEl, isOn) {
      buttonEl.textContent = isOn ? "ON" : "OFF";
      buttonEl.classList.toggle("is-on", isOn);
    }

    // Settings controls are only meaningful once a paper is actually loaded
    // — there is no paper-specific default to override, and no workflow
    // step to skip, before that. Gated on the same hasQuestions predicate
    // (and called from the same places) as the main panel's own
    // Execute/Pass/Jump controls, so "no paper loaded" reads identically
    // everywhere in the panel. The gear icon and Back button are
    // deliberately NOT gated here — opening/closing the Settings view is
    // always allowed, only the controls inside it are not.
    function applySettingsAvailability(hasQuestions) {
      const settings = window.ExamUploadAssistantSettings;

      marksOverrideToggleEl.disabled = !hasQuestions;
      penaltyOverrideToggleEl.disabled = !hasQuestions;
      selectCorrectToggleEl.disabled = !hasQuestions;
      generateAiToggleEl.disabled = !hasQuestions;
      tagsToggleEl.disabled = !hasQuestions;

      // The override inputs have two independent reasons to be disabled —
      // no paper loaded, or their own override toggle is OFF — either one
      // is sufficient.
      marksOverrideInputEl.disabled = !hasQuestions || !settings.getMarksOverride().enabled;
      penaltyOverrideInputEl.disabled = !hasQuestions || !settings.getPenaltyOverride().enabled;
    }

    function renderSettingsView() {
      const settings = window.ExamUploadAssistantSettings;

      const marksOverride = settings.getMarksOverride();
      setToggleButtonState(marksOverrideToggleEl, marksOverride.enabled);
      marksOverrideInputEl.value = marksOverride.value;

      const penaltyOverride = settings.getPenaltyOverride();
      setToggleButtonState(penaltyOverrideToggleEl, penaltyOverride.enabled);
      penaltyOverrideInputEl.value = penaltyOverride.value;

      setToggleButtonState(selectCorrectToggleEl, settings.isSelectCorrectOptionEnabled());
      setToggleButtonState(generateAiToggleEl, settings.isGenerateAiEnabled());
      setToggleButtonState(tagsToggleEl, settings.isTagsEnabled());

      applySettingsAvailability(window.ExamUploadAssistantSession.getTotalQuestions() > 0);
    }

    settingsOpenButtonEl.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });

    settingsOpenButtonEl.addEventListener("click", () => {
      renderSettingsView();
      mainViewEl.hidden = true;
      settingsViewEl.hidden = false;
    });

    settingsBackButtonEl.addEventListener("click", () => {
      settingsViewEl.hidden = true;
      mainViewEl.hidden = false;
    });

    marksOverrideToggleEl.addEventListener("click", () => {
      const settings = window.ExamUploadAssistantSettings;
      const nextEnabled = !settings.getMarksOverride().enabled;
      settings.setMarksEnabled(nextEnabled);
      setToggleButtonState(marksOverrideToggleEl, nextEnabled);
      marksOverrideInputEl.disabled = !nextEnabled;
    });

    marksOverrideInputEl.addEventListener("input", () => {
      window.ExamUploadAssistantSettings.setMarksValue(marksOverrideInputEl.value);
    });

    penaltyOverrideToggleEl.addEventListener("click", () => {
      const settings = window.ExamUploadAssistantSettings;
      const nextEnabled = !settings.getPenaltyOverride().enabled;
      settings.setPenaltyEnabled(nextEnabled);
      setToggleButtonState(penaltyOverrideToggleEl, nextEnabled);
      penaltyOverrideInputEl.disabled = !nextEnabled;
    });

    penaltyOverrideInputEl.addEventListener("input", () => {
      window.ExamUploadAssistantSettings.setPenaltyValue(penaltyOverrideInputEl.value);
    });

    selectCorrectToggleEl.addEventListener("click", () => {
      const settings = window.ExamUploadAssistantSettings;
      const nextEnabled = !settings.isSelectCorrectOptionEnabled();
      settings.setSelectCorrectOptionEnabled(nextEnabled);
      setToggleButtonState(selectCorrectToggleEl, nextEnabled);
    });

    generateAiToggleEl.addEventListener("click", () => {
      const settings = window.ExamUploadAssistantSettings;
      const nextEnabled = !settings.isGenerateAiEnabled();
      settings.setGenerateAiEnabled(nextEnabled);
      setToggleButtonState(generateAiToggleEl, nextEnabled);
    });

    tagsToggleEl.addEventListener("click", () => {
      const settings = window.ExamUploadAssistantSettings;
      const nextEnabled = !settings.isTagsEnabled();
      settings.setTagsEnabled(nextEnabled);
      setToggleButtonState(tagsToggleEl, nextEnabled);
    });

    // Controls that depend on an active session start disabled — no file has
    // been loaded yet at panel creation time.
    refreshFromSession({ message: "Ready" });

    makeDraggable(panelEl, headerEl);

    window.ExamUploadAssistantPanel.api = api;
    return api;
  }

  window.ExamUploadAssistantPanel = { create };
})();
