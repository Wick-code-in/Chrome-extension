chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" }, () => {
    // No content script listening on this tab (e.g. an unsupported page) —
    // expected and harmless. Reading lastError here is what prevents Chrome
    // from logging an "Unchecked runtime.lastError" warning for it.
    void chrome.runtime.lastError;
  });
});
