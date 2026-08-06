(function () {
  const DEFAULT_TIMEOUT_MS = 10000;

  // Selector descriptor shapes (mirrors sites/modality/domHelpers.js — this
  // file is its own copy, not shared, per the project's site-isolation
  // architecture):
  //   { tag, text, closest } — matches an element by exact trimmed visible
  //                          text, optionally walking up via closest().
  //   { labelText, find }  — finds the <label> with that exact text, then
  //                          returns the first match of `find` (defaults to
  //                          "input, select, textarea, ng-select") within
  //                          the smallest ancestor of the label containing
  //                          one.
  function findByTagAndText(tag, text, root, closestSelector) {
    const candidates = Array.from(root.querySelectorAll(tag));
    const match = candidates.find((element) => element.textContent.trim() === text) || null;

    if (!match) {
      return null;
    }

    return closestSelector ? match.closest(closestSelector) : match;
  }

  function findByLabelText(labelText, root, searchSelector = "input, select, textarea, ng-select") {
    const labels = Array.from(root.querySelectorAll("label"));
    const label = labels.find((element) => element.textContent.trim() === labelText);

    if (!label) {
      return null;
    }

    let ancestor = label.parentElement;

    while (ancestor) {
      const found = ancestor.querySelector(searchSelector);

      if (found) {
        return found;
      }

      if (ancestor === root) {
        break;
      }

      ancestor = ancestor.parentElement;
    }

    return null;
  }

  function findElement(selector, root = document) {
    if (typeof selector === "string") {
      return root.querySelector(selector);
    }

    if (selector && typeof selector === "object") {
      if ("tag" in selector && "text" in selector) {
        return findByTagAndText(selector.tag, selector.text, root, selector.closest);
      }

      if ("labelText" in selector) {
        return findByLabelText(selector.labelText, root, selector.find);
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

  function isDisabled(element) {
    return element.disabled === true || element.getAttribute("aria-disabled") === "true";
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

      // Observe document.documentElement, not `root` itself — Angular can
      // replace `root` wholesale, and documentElement is never swapped out
      // for the life of the page. Same reasoning as Modality's helper.
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

    if (isDisabled(element)) {
      return { success: false, message: `Cannot click — element is disabled: ${describeSelector(selector)}`, retryable: true };
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

    // VERIFIED live against Docxsity's Angular reactive-form inputs (Marks):
    // native value setter + input/change dispatch is enough to update the
    // value and flip the field to ng-dirty — no blur event needed.
    getNativeValueSetter(element).call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));

    return { success: true, message: `Filled input: ${describeSelector(selector)}`, retryable: false };
  }

  // ng-select interaction (Docxsity's Question Type control today; likely
  // others later). VERIFIED live 2026-08-06, not just read from ng-select's
  // own source: a real `mousedown` on .ng-select-container opens the panel
  // (a plain .click() on the host does not — ng-select binds its open
  // handler to that child element, not the host); each .ng-option row binds
  // a plain click, and the panel closes itself on selection.
  //
  // Correction to what the reverted docxsity-experiment branch assumed:
  // the .ng-dropdown-panel mounts INSIDE the <ng-select> host itself here
  // (confirmed live), not in a document-level overlay — so option lookup is
  // scoped to the resolved <ng-select> element, not the whole document.
  function getNgSelectDisplayedText(element) {
    const valueElement = element.querySelector(".ng-value");
    return valueElement ? valueElement.textContent.trim() : "";
  }

  function findNgSelectContainer(element) {
    return element.querySelector(".ng-select-container");
  }

  function findNgOption(ngSelectElement, text) {
    const options = Array.from(ngSelectElement.querySelectorAll(".ng-option"));
    return options.find((option) => option.textContent.trim() === text) || null;
  }

  function waitForNgOption(ngSelectElement, text, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return new Promise((resolve) => {
      const existing = findNgOption(ngSelectElement, text);

      if (existing && isVisible(existing)) {
        resolve({ success: true, message: `ng-select option found: ${text}`, retryable: false, element: existing });
        return;
      }

      const observer = new MutationObserver(() => {
        const found = findNgOption(ngSelectElement, text);

        if (found && isVisible(found)) {
          cleanup();
          resolve({ success: true, message: `ng-select option found: ${text}`, retryable: false, element: found });
        }
      });

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve({
          success: false,
          message: `Timed out waiting for ng-select option to appear: ${text}`,
          retryable: true,
        });
      }, timeoutMs);

      function cleanup() {
        observer.disconnect();
        clearTimeout(timeoutId);
      }

      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    });
  }

  async function selectDropdown(selector, value, { root = document } = {}) {
    const element = findElement(selector, root);

    if (!element) {
      return { success: false, message: `Cannot select dropdown — element not found: ${describeSelector(selector)}`, retryable: true };
    }

    if (!isVisible(element)) {
      return { success: false, message: `Cannot select dropdown — element is not visible: ${describeSelector(selector)}`, retryable: true };
    }

    if (isDisabled(element)) {
      return { success: false, message: `Cannot select dropdown — element is disabled: ${describeSelector(selector)}`, retryable: true };
    }

    // Idempotent: skip the open/click interaction entirely if the control
    // already shows the requested value (e.g. Question Type already
    // defaults to "MCQ Choice" when the modal opens).
    if (getNgSelectDisplayedText(element) === value) {
      return { success: true, message: `Dropdown already set to the requested value: ${describeSelector(selector)}`, retryable: false };
    }

    const container = findNgSelectContainer(element);
    if (!container) {
      return {
        success: false,
        message: `Cannot select dropdown — .ng-select-container not found inside: ${describeSelector(selector)}`,
        retryable: true,
      };
    }

    container.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));

    const optionResult = await waitForNgOption(element, value);
    if (!optionResult.success) {
      return optionResult;
    }

    optionResult.element.click();

    if (getNgSelectDisplayedText(element) !== value) {
      return {
        success: false,
        message: `Dropdown value did not take effect after selecting "${value}": ${describeSelector(selector)}`,
        retryable: true,
      };
    }

    return { success: true, message: `Selected dropdown value "${value}": ${describeSelector(selector)}`, retryable: false };
  }

  function scrollIntoView(target, root = document) {
    const element = target && typeof target === "object" && "nodeType" in target ? target : findElement(target, root);

    if (element && isVisible(element)) {
      element.scrollIntoView({ block: "center", behavior: "auto" });
    }
  }

  window.ExamUploadAssistantDomHelpers = {
    findElement,
    isVisible,
    waitForElement,
    waitForDisappear,
    clickElement,
    fillInput,
    selectDropdown,
    scrollIntoView,
  };
})();
