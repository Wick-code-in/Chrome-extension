(function () {
  const DEFAULT_TIMEOUT_MS = 10000;

  // Some elements on the target site have no stable attribute at all —
  // only presentational classes — so a selector isn't always a plain CSS
  // string. These descriptor shapes cover the cases found so far:
  //   { tag, text, closest } — an element whose own visible text is the
  //                          only stable identifier (e.g. a button with no
  //                          other attributes, or a dialog title used to
  //                          locate its enclosing dialog). `closest`, if
  //                          given, walks up from the text match to its
  //                          nearest ancestor matching that CSS selector
  //                          (via the standard Element.closest()) — used
  //                          when the stable text belongs to a descendant
  //                          (e.g. a dialog's title) rather than the
  //                          container itself, whose own attributes recur
  //                          across multiple unrelated dialogs.
  //   { labelText, find }  — a field whose only stable identifier is a
  //                          <label>'s exact text (no for/id link exists
  //                          between them). Returns the first match of
  //                          `find` (defaults to "input, select, textarea")
  //                          within the smallest ancestor of the label that
  //                          contains one — walking upward one level at a
  //                          time rather than assuming a fixed depth, since
  //                          the label and the target aren't always direct
  //                          siblings. Stopping at the shallowest matching
  //                          ancestor is what keeps this scoped correctly
  //                          when the same structure (e.g. a rich-text
  //                          editor's toolbar button) repeats elsewhere on
  //                          the page — the search never has to climb past
  //                          the one container that's specific to this
  //                          label.
  //   { optionValueParent, nearLabel } — a <select> with no stable
  //                          attribute of its own, identified via a
  //                          descendant <option>'s value (a plain attribute
  //                          selector), returning that option's parent
  //                          element. Unscoped (searches the whole `root`)
  //                          unless `nearLabel` is given, in which case the
  //                          option search is scoped the same way
  //                          { labelText, find } is — anchored to a
  //                          known-nearby <label>'s exact text and walking
  //                          up to the smallest ancestor that contains a
  //                          matching option — needed once the page can
  //                          contain more than one <select> with the same
  //                          option value (e.g. a dialog's own field vs. an
  //                          unrelated page-level filter control sharing
  //                          the same underlying value).
  function findByTagAndText(tag, text, root, closestSelector) {
    const candidates = Array.from(root.querySelectorAll(tag));
    const match = candidates.find((element) => element.textContent.trim() === text) || null;

    if (!match) {
      return null;
    }

    return closestSelector ? match.closest(closestSelector) : match;
  }

  function findByLabelText(labelText, root, searchSelector = "input, select, textarea") {
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

  function findByOptionValueParent(optionValue, root, nearLabel) {
    const optionSelector = `option[value="${optionValue}"]`;

    if (nearLabel) {
      const option = findByLabelText(nearLabel, root, optionSelector);
      return option ? option.parentElement : null;
    }

    const option = root.querySelector(optionSelector);
    return option ? option.parentElement : null;
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

      if ("optionValueParent" in selector) {
        return findByOptionValueParent(selector.optionValueParent, root, selector.nearLabel);
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

    getNativeValueSetter(element).call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));

    return { success: true, message: `Filled input: ${describeSelector(selector)}`, retryable: false };
  }

  // Rich-text fields on the target site (TinyMCE) must be populated through
  // the site's own "Markdown import" workflow, not by manipulating the
  // editor directly — confirmed by live inspection, direct interaction is
  // unreliable. This is a composition of the generic helpers above, not a
  // new primitive: click a trigger button, wait for the import modal, fill
  // its raw-markdown textarea, click confirm, wait for the modal to close.
  //
  // It takes a bundle of four selectors rather than one, since the workflow
  // spans multiple elements and is shared across every rich-text field
  // (Question, each Option, Explanation) — only the trigger button differs
  // per field; the modal/textarea/confirm button are the same shared modal
  // reused every time, so no site-specific knowledge is hardcoded here.
  //   triggerButton — the field-specific button that opens the modal
  //   modal         — the modal container (used for both appearing and
  //                   disappearing waits)
  //   textarea      — the modal's raw-markdown textarea
  //   confirmButton — the modal's confirm/insert button
  async function pasteMarkdown(selectors, markdownText, options = {}) {
    const { triggerButton, modal, textarea, confirmButton } = selectors;

    const clickTriggerResult = clickElement(triggerButton, options);
    if (!clickTriggerResult.success) {
      return clickTriggerResult;
    }

    const waitModalResult = await waitForElement(modal, options);
    if (!waitModalResult.success) {
      return waitModalResult;
    }

    // Scope the remaining lookups to the modal element we just confirmed,
    // rather than re-searching the whole document — this avoids any
    // ambiguity with structurally similar dialogs elsewhere on the page.
    const withinModal = { ...options, root: waitModalResult.element };

    const fillResult = fillInput(textarea, markdownText, withinModal);
    if (!fillResult.success) {
      return fillResult;
    }

    const confirmResult = clickElement(confirmButton, withinModal);
    if (!confirmResult.success) {
      return confirmResult;
    }

    const waitDisappearResult = await waitForDisappear(modal, options);
    if (!waitDisappearResult.success) {
      return waitDisappearResult;
    }

    return {
      success: true,
      message: `Pasted markdown via ${describeSelector(triggerButton)}`,
      retryable: false,
    };
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
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));

    if (element.value !== value) {
      return {
        success: false,
        message: `Dropdown value did not take effect after selecting "${value}": ${describeSelector(selector)}`,
        retryable: true,
      };
    }

    return { success: true, message: `Selected dropdown value "${value}": ${describeSelector(selector)}`, retryable: false };
  }

  // Post-action Auto Focus: brings a just-acted-on element into view so the
  // operator can immediately inspect the result, without affecting the
  // calling step's success/failure. `target` may be an already-resolved
  // Element (cheap reuse when a handler already has one, e.g. from
  // waitForElement) or a selector to resolve fresh via findElement (needed
  // when nothing was captured, e.g. after a modal-scoped workflow closes).
  // Silently does nothing if the target can't be found or isn't visible —
  // this is cosmetic only and must never surface as a failure.
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
    pasteMarkdown,
    selectDropdown,
    scrollIntoView,
  };
})();
