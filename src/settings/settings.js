async function loadMics(selected) {
  const micSelect = document.getElementById("mic");
  try {
    // Prompt for mic permission so device labels are populated.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    for (const d of devices.filter((d) => d.kind === "audioinput")) {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Microphone ${micSelect.length}`;
      micSelect.appendChild(opt);
    }
    if (selected) micSelect.value = selected;
  } catch (err) {
    console.error("mic enumeration failed", err);
  }
}

function fillKeySelect(select, keys, selected, { includeNone = false } = {}) {
  select.replaceChildren();
  if (includeNone) {
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "— none —";
    select.appendChild(none);
  }
  for (const key of keys) {
    const opt = document.createElement("option");
    opt.value = key.name;
    opt.textContent = key.label;
    select.appendChild(opt);
  }
  select.value = selected || "";
}

function fillModelSelect(models, modelsError, saved) {
  const select = document.getElementById("summaryModel");
  const warn = document.getElementById("modelWarn");
  select.replaceChildren();

  // Without a list, offer the saved value alone rather than an empty dropdown
  // that would silently blank the setting on save.
  const options = models && models.length > 0 ? models : [saved];
  if (models && models.length > 0 && !models.includes(saved)) options.unshift(saved);

  for (const id of options) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    select.appendChild(opt);
  }
  select.value = saved;

  const hasList = Boolean(models && models.length > 0);
  warn.hidden = hasList;
  if (!hasList) {
    warn.textContent = modelsError
      ? `Could not load model list: ${modelsError}`
      : "Could not load model list — save an API key to load it.";
  }
}

function setStatus(text, isError) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.classList.toggle("error", Boolean(isError));
}

async function init() {
  const { config, hasKey, keys, models, modelsError } = await window.settingsAPI.get();

  fillKeySelect(document.getElementById("recordKey"), keys, config.recordKey);
  fillKeySelect(document.getElementById("summaryKey1"), keys, config.summaryKeys[0], {
    includeNone: true,
  });
  fillKeySelect(document.getElementById("summaryKey2"), keys, config.summaryKeys[1], {
    includeNone: true,
  });
  fillModelSelect(models, modelsError, config.summaryModel);

  document.getElementById("language").value = config.language;
  document.getElementById("summaryPrompt").value = config.summaryPrompt;
  document.getElementById("separator").value = config.separator;
  document.getElementById("autoLaunch").checked = config.autoLaunch;
  document.getElementById("apiKey").placeholder = hasKey
    ? "leave blank to keep current key"
    : "enter your Mistral API key";
  await loadMics(config.micDeviceId);

  document.getElementById("save").addEventListener("click", async () => {
    const micValue = document.getElementById("mic").value;
    const chord = [
      document.getElementById("summaryKey1").value,
      document.getElementById("summaryKey2").value,
    ].filter(Boolean);
    const payload = {
      config: {
        language: document.getElementById("language").value,
        recordKey: document.getElementById("recordKey").value,
        // Either key set to "— none —" disables the chord entirely.
        summaryKeys: chord.length === 2 ? chord : [],
        summaryModel: document.getElementById("summaryModel").value,
        summaryPrompt: document.getElementById("summaryPrompt").value,
        separator: document.getElementById("separator").value,
        micDeviceId: micValue || null,
        autoLaunch: document.getElementById("autoLaunch").checked,
      },
      apiKey: document.getElementById("apiKey").value,
    };

    const result = await window.settingsAPI.save(payload);
    if (result && result.ok === false) {
      setStatus(result.error, true);
      return;
    }

    if (result) {
      fillModelSelect(result.models, result.modelsError, payload.config.summaryModel);
    }
    document.getElementById("apiKey").value = "";
    setStatus("Saved", false);
    setTimeout(() => setStatus("", false), 2000);
  });
}

init();
