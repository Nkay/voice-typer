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

  const haveModels = Array.isArray(models);
  const options = haveModels && models.length > 0 ? [...models] : [saved];
  if (haveModels && models.length > 0 && !models.includes(saved)) options.unshift(saved);

  for (const id of options) {
    const opt = document.createElement("option");
    opt.value = id;
    // Display: strip prefix, add provider label
    const match = id.match(/^(mistral|google)\/(.*)/);
    opt.textContent = match ? `${match[2]} (${match[1] === "mistral" ? "Mistral" : "Google"})` : id;
    select.appendChild(opt);
  }
  select.value = saved;

  const hasList = haveModels && models.length > 0;
  warn.hidden = hasList;
  if (!hasList) {
    if (modelsError) {
      warn.textContent = `Could not load model list: ${modelsError}`;
    } else if (haveModels) {
      warn.textContent = "No chat-capable models are available on this account.";
    } else {
      warn.textContent = "Could not load model list — save an API key to load it.";
    }
  }
}

function setStatus(text, isError) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.classList.toggle("error", Boolean(isError));
}

async function init() {
  try {
    const { config, hasKey, hasGoogleKey, keys, models, modelsError } = await window.settingsAPI.get();

    fillKeySelect(document.getElementById("recordKey"), keys, config.recordKey);
    fillKeySelect(document.getElementById("summaryModifier"), keys, config.summaryModifier, {
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
    document.getElementById("transcriptionProvider").value = config.transcriptionProvider || "mistral";
    document.getElementById("googleApiKey").placeholder = hasGoogleKey
      ? "leave blank to keep current key"
      : "enter your Google API key";
    await loadMics(config.micDeviceId);

    document.getElementById("save").addEventListener("click", async () => {
      try {
        const micValue = document.getElementById("mic").value;
        const payload = {
          config: {
            language: document.getElementById("language").value,
            recordKey: document.getElementById("recordKey").value,
            summaryModifier: document.getElementById("summaryModifier").value,
            summaryModel: document.getElementById("summaryModel").value,
            summaryPrompt: document.getElementById("summaryPrompt").value,
            separator: document.getElementById("separator").value,
            micDeviceId: micValue || null,
            autoLaunch: document.getElementById("autoLaunch").checked,
            transcriptionProvider: document.getElementById("transcriptionProvider").value,
          },
          apiKey: document.getElementById("apiKey").value,
          googleApiKey: document.getElementById("googleApiKey").value,
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
        document.getElementById("googleApiKey").value = "";
        setStatus("Saved", false);
        setTimeout(() => setStatus("", false), 2000);
      } catch (err) {
        console.error("VoiceTyper settings: save failed", err);
        setStatus("Save failed — see the console for details", true);
      }
    });
  } catch (err) {
    console.error("VoiceTyper settings: failed to load settings", err);
    setStatus("Could not load settings — see the console for details", true);
  }
}

init();
