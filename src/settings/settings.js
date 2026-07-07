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

async function init() {
  const { config, hasKey } = await window.settingsAPI.get();
  document.getElementById("language").value = config.language;
  document.getElementById("recordKey").value = config.recordKey;
  document.getElementById("autoLaunch").checked = config.autoLaunch;
  document.getElementById("apiKey").placeholder = hasKey
    ? "leave blank to keep current key"
    : "enter your Mistral API key";
  await loadMics(config.micDeviceId);

  document.getElementById("save").addEventListener("click", async () => {
    const micValue = document.getElementById("mic").value;
    const payload = {
      config: {
        language: document.getElementById("language").value,
        recordKey: document.getElementById("recordKey").value,
        micDeviceId: micValue || null,
        autoLaunch: document.getElementById("autoLaunch").checked,
      },
      apiKey: document.getElementById("apiKey").value,
    };
    await window.settingsAPI.save(payload);
    document.getElementById("status").textContent = "Saved";
    setTimeout(() => (document.getElementById("status").textContent = ""), 2000);
  });
}

init();
