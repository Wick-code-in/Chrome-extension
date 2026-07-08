(function () {
  const DEFAULT_TIMEOUT_MS = 10000;

  function findElement(selector, root = document) {
    return root.querySelector(selector);
  }

  function isVisible(element) {
    if (!element || !element.isConnected) {
      return false;
    }

    const style = window.getComputedStyle(element);

    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function waitForElement(selector, { timeoutMs = DEFAULT_TIMEOUT_MS, root = document } = {}) {
    return new Promise((resolve) => {
      const existing = findElement(selector, root);

      if (existing && isVisible(existing)) {
        resolve({ success: true, message: `Element found: ${selector}`, retryable: false, element: existing });
        return;
      }

      const observer = new MutationObserver(() => {
        const found = findElement(selector, root);

        if (found && isVisible(found)) {
          cleanup();
          resolve({ success: true, message: `Element found: ${selector}`, retryable: false, element: found });
        }
      });

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve({
          success: false,
          message: `Timed out waiting for element to appear: ${selector}`,
          retryable: true,
        });
      }, timeoutMs);

      function cleanup() {
        observer.disconnect();
        clearTimeout(timeoutId);
      }

      // Observe document.documentElement rather than `root` itself: if the
      // framework replaces `root` wholesale (unmount/remount), an observer
      // attached to the old `root` reference would never see the
      // replacement. documentElement is never swapped out for the life of
      // the page, so it remains a reliable, stable observation target
      // regardless of what happens inside it. `root` is still used above
      // for the actual query — only the mutation-detection target changes.
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    });
  }

  function waitForDisappear(selector, { timeoutMs = DEFAULT_TIMEOUT_MS, root = document } = {}) {
    return new Promise((resolve) => {
      function isGone() {
        const element = findElement(selector, root);
        return !element || !isVisible(element);
      }

      if (isGone()) {
        resolve({ success: true, message: `Element already absent: ${selector}`, retryable: false });
        return;
      }

      const observer = new MutationObserver(() => {
        if (isGone()) {
          cleanup();
          resolve({ success: true, message: `Element disappeared: ${selector}`, retryable: false });
        }
      });

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve({
          success: false,
          message: `Timed out waiting for element to disappear: ${selector}`,
          retryable: true,
        });
      }, timeoutMs);

      function cleanup() {
        observer.disconnect();
        clearTimeout(timeoutId);
      }

      // Same reasoning as waitForElement: observe the stable
      // documentElement, not the possibly-replaced `root`.
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    });
  }

  function clickElement(selector, { root = document } = {}) {
    const element = findElement(selector, root);

    if (!element) {
      return { success: false, message: `Cannot click — element not found: ${selector}`, retryable: true };
    }

    if (!isVisible(element)) {
      return { success: false, message: `Cannot click — element is not visible: ${selector}`, retryable: true };
    }

    element.click();

    return { success: true, message: `Clicked: ${selector}`, retryable: false };
  }

  function getNativeValueSetter(element) {
    const prototype =
      element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    return Object.getOwnPropertyDescriptor(prototype, "value").set;
  }

  function fillInput(selector, value, { root = document } = {}) {
    const element = findElement(selector, root);

    if (!element) {
      return { success: false, message: `Cannot fill input — element not found: ${selector}`, retryable: true };
    }

    if (!isVisible(element)) {
      return { success: false, message: `Cannot fill input — element is not visible: ${selector}`, retryable: true };
    }

    getNativeValueSetter(element).call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));

    return { success: true, message: `Filled input: ${selector}`, retryable: false };
  }

  function pasteMarkdown(selector, markdownText, { root = document } = {}) {
    const element = findElement(selector, root);

    if (!element) {
      return { success: false, message: `Cannot paste markdown — element not found: ${selector}`, retryable: true };
    }

    if (!isVisible(element)) {
      return {
        success: false,
        message: `Cannot paste markdown — element is not visible: ${selector}`,
        retryable: true,
      };
    }

    element.focus();

    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", markdownText);

    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    });

    element.dispatchEvent(pasteEvent);

    return { success: true, message: `Pasted markdown into: ${selector}`, retryable: false };
  }

  function selectDropdown(selector, value, { root = document } = {}) {
    const element = findElement(selector, root);

    if (!element) {
      return { success: false, message: `Cannot select dropdown — element not found: ${selector}`, retryable: true };
    }

    if (!isVisible(element)) {
      return {
        success: false,
        message: `Cannot select dropdown — element is not visible: ${selector}`,
        retryable: true,
      };
    }

    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));

    return { success: true, message: `Selected dropdown value "${value}": ${selector}`, retryable: false };
  }

  window.ExamUploadAssistantDomHelpers = {
    findElement,
    isVisible,
    waitForElement,
    waitForDisappear,
    clickElement,
    fillInput,
    pasteMarkdown,
    selectDropdown,
  };
})();
