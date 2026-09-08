(function () {
  // Extension-wide Slideshow controller — an in-memory module scope exposed
  // as window.ExamUploadAssistantSlideshow, following the exact pattern
  // lib/session.js and lib/settings.js already established. No DOM, no
  // selectors, no site-awareness beyond reading the state machine's own
  // supportsSlideshow capability flag: the only primitive this file calls
  // is window.ExamUploadAssistantStateMachine.executeStep(), which already
  // performs every completion wait a single step needs (see
  // sites/docxsity/stateMachine.js's runGenerateAi/runSave). This file adds
  // nothing beyond "call it again, in a loop, until told to stop or until
  // the paper is done" — no new completion detection, no fixed delays, no
  // retry logic, and no Question-Group awareness (determineNextState()
  // inside executeStep() already handles that entirely on its own).
  //
  // Non-persistent by construction, same reason Session/Settings already
  // are: this is plain module-scope state that resets for free whenever the
  // content script is reinjected (page reload, extension reload).
  let running = false;
  let stopRequested = false;

  function isRunning() {
    return running;
  }

  // Does not cancel an in-flight executeStep() call — nothing in this
  // codebase's wait primitives (waitForElement/waitForDisappear) exposes a
  // cancellation handle, so there is no way to interrupt one. This only
  // flips a flag that the loop below checks between iterations, meaning the
  // current step (however long its own wait takes) always finishes
  // naturally before a pause actually takes effect. Calling this when no
  // run is active, or after one has already stopped on its own, is a
  // harmless no-op.
  function pause() {
    stopRequested = true;
  }

  // Runs the existing state machine forward, one full executeStep() call at
  // a time, until: the operator pauses, a step fails, or Session reports
  // COMPLETE. Each iteration fully awaits the previous one — executeStep()
  // is never called again until the prior call's Promise has resolved —
  // which is what makes this safe to build on top of a state machine that
  // was never designed to be re-entrant (see sites/docxsity/stateMachine.js
  // and debugging-notes.md's "Execute Step re-entrancy" entry: the danger
  // was always concurrent calls, never sequential ones).
  //
  // callbacks.onStep(result) fires after every single executeStep() call
  // (success or failure) so the caller can refresh its own UI the same way
  // it already would for one manual Execute click.
  // callbacks.onStopped(reason, lastResult) fires exactly once, after the
  // loop has fully exited and `running` is already false, with reason one
  // of "unsupported", "already-running", "paused", "failed", or "complete".
  async function start(callbacks = {}) {
    if (running) {
      return { started: false, reason: "already-running" };
    }

    const StateMachine = window.ExamUploadAssistantStateMachine;

    // Defense in depth: content/panel.js is expected to never render the
    // Play control at all when this flag is false (see
    // sites/modality/stateMachine.js), but this file is loaded on every
    // site regardless, and is reachable directly (e.g. via the console)
    // whether or not the button exists. Refusing here means a bypass of the
    // UI can never drive Modality's click-only GENERATE_AI/SAVE through an
    // unattended loop.
    if (!StateMachine || !StateMachine.supportsSlideshow) {
      const result = { started: false, reason: "unsupported" };
      if (typeof callbacks.onStopped === "function") {
        callbacks.onStopped("unsupported", null);
      }
      return result;
    }

    const Session = window.ExamUploadAssistantSession;

    running = true;
    stopRequested = false;

    let reason = "paused";
    let lastResult = null;

    while (true) {
      // Checked before calling executeStep() again — never mid-step, since
      // nothing can interrupt a step already in flight.
      if (Session.getCurrentState() === "COMPLETE") {
        reason = "complete";
        break;
      }

      if (stopRequested) {
        reason = "paused";
        break;
      }

      lastResult = await StateMachine.executeStep();

      if (typeof callbacks.onStep === "function") {
        callbacks.onStep(lastResult);
      }

      // Fail-stop policy, deliberately with no exceptions and no branching
      // on message content or the (already-dead, per debugging-notes.md)
      // retryable field: any failure — a missing answer key, a missing
      // marking scheme, a Generate AI timeout, a Save validation error, a
      // transient DOM miss — stops the run the same way. Session is left
      // exactly where executeStep() left it; no rollback, no auto-Pass, no
      // retry is attempted here.
      if (!lastResult.success) {
        reason = "failed";
        break;
      }
    }

    running = false;

    if (typeof callbacks.onStopped === "function") {
      callbacks.onStopped(reason, lastResult);
    }

    return { started: true, reason };
  }

  window.ExamUploadAssistantSlideshow = {
    isRunning,
    start,
    pause,
  };
})();
