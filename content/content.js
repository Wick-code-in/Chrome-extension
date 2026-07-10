(function () {
  const HOST_ID = "exam-upload-assistant-host";

  function injectPanel() {
    if (document.getElementById(HOST_ID)) {
      return;
    }

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.display = "none";
    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: "open" });

    window.ExamUploadAssistantPanel.create(shadowRoot);
  }

  function togglePanelVisibility() {
    const host = document.getElementById(HOST_ID);

    if (!host) {
      return;
    }

    host.style.display = host.style.display === "none" ? "" : "none";
  }

  function whenBodyReady(callback) {
    if (document.body) {
      callback();
      return;
    }

    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        callback();
      }
    });

    observer.observe(document.documentElement, { childList: true });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "TOGGLE_PANEL") {
      togglePanelVisibility();
    }
  });

  whenBodyReady(injectPanel);
})();
