const path = require("path");

const configModule = require("../shared/config.js");
const { encodeWav } = require("../shared/wav.js");
const { transcribe } = require("../shared/transcriber.js");
const { createSecrets } = require("./secrets.js");
const { Hotkey } = require("./hotkey.js");
const { createTyper } = require("./typer.js");
const { createTray } = require("./tray.js");
const { createRecorderBridge } = require("./recorderBridge.js");
const { Controller } = require("./controller.js");
const { summarize } = require("../shared/summarizer.js");
const { fetchChatModels: defaultFetchChatModels } = require("../shared/models.js");
const { transcribe: googleTranscribe } = require("../shared/google-transcriber.js");
const { summarize: googleSummarize } = require("../shared/google-summarizer.js");
const { fetchGeminiModels: defaultFetchGeminiModels } = require("../shared/google-models.js");
const { KEYS } = require("../shared/keys.js");

// All Electron and native-module surfaces are injected so the wiring can be
// exercised in tests without an Electron runtime.
function boot({
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  safeStorage,
  ipcMain,
  Notification,
  createListener,
  keyboard,
  Key,
  fetchChatModels = defaultFetchChatModels,
  fetchGeminiModels = defaultFetchGeminiModels,
}) {
  // Slow the synthetic typing slightly so target apps keep up.
  keyboard.config.autoDelayMs = 2;

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  let state = { models: null, modelsError: null, modelsPromise: null };

  const notify = (title, body) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  };

  // Cached because the Settings window may open repeatedly and the list rarely
  // changes. A failure is recorded as a message, never thrown: the app must boot
  // and record without a model list.
  const refreshModels = async () => {
    const hasMistral = state.secrets.hasKey();
    const hasGoogle = state.secrets.hasGoogleKey();

    if (!hasMistral && !hasGoogle) {
      state.models = null;
      state.modelsError = null;
      return;
    }

    const results = await Promise.allSettled([
      hasMistral
        ? fetchChatModels({ apiKey: state.secrets.getKey() })
        : Promise.resolve([]),
      hasGoogle
        ? fetchGeminiModels({ apiKey: state.secrets.getGoogleKey() })
        : Promise.resolve([]),
    ]);

    const mistralModels = results[0].status === "fulfilled" ? results[0].value : [];
    const googleModels = results[1].status === "fulfilled" ? results[1].value : [];
    const errors = [];
    if (results[0].status === "rejected" && hasMistral) {
      errors.push(`Mistral: ${results[0].reason?.message || "failed"}`);
    }
    if (results[1].status === "rejected" && hasGoogle) {
      errors.push(`Google: ${results[1].reason?.message || "failed"}`);
    }

    const merged = [
      ...mistralModels.map((id) => `mistral/${id}`),
      ...googleModels.map((id) => `google/${id}`),
    ].sort();

    state.models = merged.length > 0 ? merged : null;
    state.modelsError = errors.length > 0 ? errors.join("; ") : null;

    if (errors.length > 0) {
      state.modelsPromise = null;
    }
  };

  const modelsReady = () => {
    // Join the in-flight fetch rather than starting a second one.
    if (!state.modelsPromise) state.modelsPromise = refreshModels();
    return state.modelsPromise;
  };

  const createHiddenWindow = () => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "..", "renderer", "recorder-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.loadFile(path.join(__dirname, "..", "renderer", "recorder.html"));
    return win;
  };

  const openSettings = () => {
    if (state.settingsWin && !state.settingsWin.isDestroyed()) {
      state.settingsWin.focus();
      return;
    }
    state.settingsWin = new BrowserWindow({
      width: 420,
      height: 700,
      resizable: false,
      title: "VoiceTyper Settings",
      webPreferences: {
        preload: path.join(__dirname, "..", "settings", "settings-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    state.settingsWin.setMenuBarVisibility(false);
    state.settingsWin.loadFile(path.join(__dirname, "..", "settings", "settings.html"));
  };

  app.whenReady().then(() => {
    const userData = app.getPath("userData");
    const configPath = path.join(userData, "config.json");
    const keyPath = path.join(userData, "key.enc");

    state.config = configModule.loadConfig(configPath);
    const googleKeyPath = path.join(userData, "google-key.enc");
    state.secrets = createSecrets({ safeStorage, filePath: keyPath, googleFilePath: googleKeyPath });

    if (state.secrets.hasKey() || state.secrets.hasGoogleKey()) {
      state.modelsPromise = refreshModels();
    }

    app.setLoginItemSettings({ openAtLogin: state.config.autoLaunch });

    state.hiddenWin = createHiddenWindow();

    const recorder = createRecorderBridge({
      send: (channel, ...args) => state.hiddenWin.webContents.send(channel, ...args),
      encodeWav,
      // Renderer needs the currently-configured mic each time capture starts.
      getStartOpts: () => ({ micDeviceId: state.config.micDeviceId }),
    });
    ipcMain.on("capture:pcm", (_e, arrayBuffer, sampleRate) =>
      recorder.handlePcm(arrayBuffer, sampleRate)
    );

    state.hotkey = new Hotkey({
      recordKey: state.config.recordKey,
      summaryModifier: state.config.summaryModifier,
      createListener,
    });
    try {
      state.hotkey.start();
    } catch (err) {
      console.error("VoiceTyper: hotkey listener failed to start", err);
      notify("VoiceTyper", "Hotkey listener failed to start — recording is disabled.");
    }

    const typer = createTyper({ keyboard, Key });

    state.tray = createTray({
      Tray,
      Menu,
      nativeImage,
      iconDir: path.join(__dirname, "..", "..", "assets", "tray"),
      onTogglePause: () => state.controller.setPaused(!state.controller.isPaused()),
      onOpenSettings: openSettings,
      onQuit: () => app.quit(),
      // createTray builds the menu once immediately, before the controller
      // below exists — report unpaused until it does.
      isPaused: () => (state.controller ? state.controller.isPaused() : false),
    });

    state.controller = new Controller({
      hotkey: state.hotkey,
      recorder,
      transcribe,
      googleTranscribe,
      summarize,
      googleSummarize,
      typer,
      tray: state.tray,
      getApiKey: () => state.secrets.getKey(),
      getGoogleApiKey: () => state.secrets.getGoogleKey(),
      getConfig: () => state.config,
      notify,
      minDurationMs: 200,
      minHoldMs: 1000,
      sampleRate: 16000,
    });
    state.controller.start();

    if (!state.secrets.hasKey() && !state.secrets.hasGoogleKey()) {
      notify("VoiceTyper", "Set your API key in Settings (tray icon → Settings).");
    }

    // --- Settings IPC ---
    ipcMain.handle("settings:get", async () => {
      if (state.secrets.hasKey() || state.secrets.hasGoogleKey()) await modelsReady();
      return {
        config: state.config,
        hasKey: state.secrets.hasKey(),
        hasGoogleKey: state.secrets.hasGoogleKey(),
        keys: KEYS,
        models: state.models,
        modelsError: state.modelsError,
      };
    });

    ipcMain.handle("settings:save", async (_e, { config, apiKey, googleApiKey }) => {
      const candidate = configModule.mergeConfig(config);
      // mergeConfig silently disables an invalid modifier; re-check the raw
      // input so the user is told why rather than finding the summary
      // command quietly switched off.
      const modifierError = configModule.summaryModifierError(
        candidate.recordKey,
        config && config.summaryModifier
      );
      if (modifierError) return { ok: false, error: modifierError };

      // Validate provider/key requirements
      const googleKeyChanged = typeof googleApiKey === "string" && googleApiKey.length > 0;
      const willHaveGoogleKey = googleKeyChanged || state.secrets.hasGoogleKey();
      const needsGoogle = candidate.transcriptionProvider === "google" || candidate.transcriptionProvider === "both";
      if (needsGoogle && !willHaveGoogleKey) {
        return { ok: false, error: "Google API key is required for this transcription provider." };
      }
      if (candidate.summaryModel.startsWith("google/") && !willHaveGoogleKey) {
        return { ok: false, error: "Google API key is required for this summary model." };
      }

      state.config = candidate;
      configModule.saveConfig(configPath, state.config);

      const keyChanged = typeof apiKey === "string" && apiKey.length > 0;
      if (keyChanged) state.secrets.setKey(apiKey);
      if (googleKeyChanged) state.secrets.setGoogleKey(googleApiKey);

      app.setLoginItemSettings({ openAtLogin: state.config.autoLaunch });
      state.hotkey.setBindings({
        recordKey: state.config.recordKey,
        summaryModifier: state.config.summaryModifier,
      });
      state.controller.refreshKeyState();

      if (keyChanged || googleKeyChanged) {
        state.modelsPromise = refreshModels();
        await state.modelsPromise;
      }

      return { ok: true, models: state.models, modelsError: state.modelsError };
    });
  });

  app.on("second-instance", () => openSettings());
  app.on("window-all-closed", (event) => event.preventDefault());
  app.on("before-quit", () => {
    if (state.hotkey) state.hotkey.stop();
    if (state.tray) state.tray.destroy();
  });
}

module.exports = { boot };
