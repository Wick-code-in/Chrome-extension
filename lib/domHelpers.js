(function () {
  const DEFAULT_TIMEOUT_MS = 10000;

  // Some elements on the target site have no stable attribute at all —
  // only presentational classes — so a selector isn't always a plain CSS
  // string. These descriptor shapes cover the cases found so far:
  //   { tag, text }        — an element whose own visible text is the only
  //                          stable identifier (e.g. a button with no other
  //                          attributes).
  //   { labelText }        — an unlabeled form control whose only stable
  //                          identifier is a sibling <label>'s text (no
  //                          for/id link exists between them).
  //   { optionValueParent } — a <select> with no stable attribute of its
  //                          own, identified via a descendant <option>'s
  //                          value (a plain attribute selector), returning
  //                          that option's parent element.
  function findByTagAndText(tag, text, root) {
    const candidates = Array.from(root.querySelectorAll(tag));
    return candidates.find((element) => element.textContent.trim() === text) || null;
  }

  function findByLabelText(labelText, root) {
    const labels = Array.from(root.querySelectorAll("label"));
    const label = labels.find((element) => element.textContent.trim() === labelText);

    if (!label || !label.parentElement) {
      return null;
    }

    return label.parentElement.querySelector("input, select, textarea");
  }

  function findByOptionValueParent(optionValue, root) {
    const option = root.querySelector(`option[value="${optionValue}"]`);
    return option ? option.parentElement : null;
  }

  function findElement(selector, root = document) {
    if (typeof selector === "string") {
      return root.querySelector(selector);
    }

    if (selector && typeof selector === "object") {
      if ("tag" in selector && "text" in selector) {
        return findByTagAndText(selector.tag, selector.text, root);
      }

      if ("labelText" in selector) {
        return findByLabelText(selector.labelText, root);
      }

      if ("optionValueParent" in selector) {
        return findByOptionValueParent(selector.optionValueParent, root);
      }
    }

    return null;
  }

  function describeSelector(selector) {
    return typeof selector === "string" ? selector : JSON.stringify(selector);
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
        resolve({ success: true, message: `Element found: ${describeSelector(selector)}`, retryable: false, element: existing });
        return;
      }

      const observer = new MutationObserver(() => {
        const found = findElement(selector, root);

        if (found && isVisible(found)) {
          cleanup();
          resolve({ success: true, message: `Element found: ${describeSelector(selector)}`, retryable: false, element: found });
        }
      });

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve({
          success: false,
          message: `Timed out waiting for element to appear: ${describeSelector(selector)}`,
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
        resolve({ success: true, message: `Element already absent: ${describeSelector(selector)}`, retryable: false });
        return;
      }

      const observer = new MutationObserver(() => {
        if (isGone()) {
          cleanup();
          resolve({ success: true, message: `Element disappeared: ${describeSelector(selector)}`, retryable: false });
        }
      });

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve({
          success: false,
          message: `Timed out waiting for element to disappear: ${describeSelector(selector)}`,
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
      return { success: false, message: `Cannot click — element not found: ${describeSelector(selector)}`, retryable: true };
    }

    if (!isVisible(element)) {
      return { success: false, message: `Cannot click — element is not visible: ${describeSelector(selector)}`, retryable: true };
    }

    element.click();

    return { success: true, message: `Clicked: ${describeSelector(selector)}`, retryable: false };
  }

  function getNativeValueSetter(element) {
    let prototype = window.HTMLInputElement.prototype;

    if (element.tagName === "TEXTAREA") {
      prototype = window.HTMLTextAreaElement.prototype;
    } else if (element.tagName === "SELECT") {
      prototype = window.HTMLSelectElement.prototype;
    }

    return Object.getOwnPropertyDescriptor(prototype, "value").set;
  }

  function fillInput(selector, value, { root = document } = {}) {
    const element = findElement(selector, root);

    if (!element) {
      return { success: false, message: `Cannot fill input — element not found: ${describeSelector(selector)}`, retryable: true };
    }

    if (!isVisible(element)) {
      return { success: false, message: `Cannot fill input — element is not visible: ${describeSelector(selector)}`, retryable: true };
    }

    getNativeValueSetter(element).call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));

    return { success: true, message: `Filled input: ${describeSelector(selector)}`, retryable: false };
  }

  function pasteMarkdown(selector, markdownText, { root = document } = {}) {
    const element = findElement(selector, root);

    if (!element) {
      return { success: false, message: `Cannot paste markdown — element not found: ${describeSelector(selector)}`, retryable: true };
    }

    if (!isVisible(element)) {
      return {
        success: false,
        message: `Cannot paste markdown — element is not visible: ${describeSelector(selector)}`,
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

    return { success: true, message: `Pasted markdown into: ${describeSelector(selector)}`, retryable: false };
  }

  function selectDropdown(selector, value, { root = document } = {}) {
    const element = findElement(selector, root);

    if (!element) {
      return { success: false, message: `Cannot select dropdown — element not found: ${describeSelector(selector)}`, retryable: true };
    }

    if (!isVisible(element)) {
      return {
        success: false,
        message: `Cannot select dropdown — element is not visible: ${describeSelector(selector)}`,
        retryable: true,
      };
    }

    getNativeValueSetter(element).call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));

    return { success: true, message: `Selected dropdown value "${value}": ${describeSelector(selector)}`, retryable: false };
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
