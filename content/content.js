(function () {
  const HOST_ID = "exam-upload-assistant-host";

  function injectPanel() {
    if (document.getElementById(HOST_ID)) {
      return;
    }

    const host = document.createElement("div");
    host.id = HOST_ID;
    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: "open" });

    window.ExamUploadAssistantPanel.create(shadowRoot);
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

  whenBodyReady(injectPanel);
})();
