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

  // `models` is null when no list is available at all (no key, or the fetch
  // failed) and an array — possibly empty — when the fetch succeeded.
  const haveModels = Array.isArray(models);

  // Without a list, offer the saved value alone rather than an empty dropdown
  // that would silently blank the setting on save. Copy the array before
  // unshifting into it — `models` belongs to the caller.
  const options = haveModels && models.length > 0 ? [...models] : [saved];
  if (haveModels && models.length > 0 && !models.includes(saved)) options.unshift(saved);

  for (const id of options) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    select.appendChild(opt);
  }
  select.value = saved;

  const hasList = haveModels && models.length > 0;
  warn.hidden = hasList;
  if (!hasList) {
    if (modelsError) {
      warn.textContent = `Could not load model list: ${modelsError}`;
    } else if (haveModels) {
      // A successful fetch that legitimately returned nothing — distinct from
      // "no list available" (missing key, or the request itself failed).
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
    const { config, hasKey, keys, models, modelsError } = await window.settingsAPI.get();

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
