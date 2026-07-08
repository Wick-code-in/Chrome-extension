(function () {
  let rawMarkdown = null;
  let filename = null;

  function readFile(file, onComplete) {
    if (!file.name.toLowerCase().endsWith(".md")) {
      onComplete({ success: false, message: "Please select a Markdown (.md) file." });
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";

      if (text.length === 0) {
        onComplete({ success: false, message: "The selected file is empty." });
        return;
      }

      rawMarkdown = text;
      filename = file.name;
      onComplete({ success: true, message: "Markdown Loaded", filename });
    };

    reader.onerror = () => {
      onComplete({ success: false, message: "Failed to read the selected file." });
    };

    reader.readAsText(file, "UTF-8");
  }

  function openFilePicker(onComplete) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,text/markdown";

    input.addEventListener("change", () => {
      const file = input.files && input.files[0];

      if (!file) {
        onComplete({ success: false, message: "No file was selected." });
        return;
      }

      readFile(file, onComplete);
    });

    input.addEventListener("cancel", () => {
      onComplete({ success: false, message: "File selection was cancelled." });
    });

    input.click();
  }

  window.ExamUploadAssistantLoader = {
    openFilePicker,
    getRawMarkdown: () => rawMarkdown,
    getFilename: () => filename,
    hasFileLoaded: () => rawMarkdown !== null,
  };
})();
