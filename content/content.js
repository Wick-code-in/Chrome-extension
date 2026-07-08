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

    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
      }
      .panel {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        padding: 12px 16px;
        border-radius: 8px;
        background: #1e1e1e;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }
    `;

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.textContent = "Hello World";

    shadowRoot.appendChild(style);
    shadowRoot.appendChild(panel);
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
