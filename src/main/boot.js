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
    if (!state.secrets || !state.secrets.hasKey()) {
      state.models = null;
      state.modelsError = null;
      return;
    }
    try {
      state.models = await fetchChatModels({ apiKey: state.secrets.getKey() });
      state.modelsError = null;
    } catch (err) {
      state.models = null;
      state.modelsError = err && err.message ? err.message : "Could not load model list";
      // Don't memoize a failure forever: any awaiters already hold this promise
      // object, so clearing the field is safe, and it lets the next
      // settings:get (or another refreshModels() call) start a fresh attempt
      // instead of replaying a stale rejection for the rest of the process.
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
    state.secrets = createSecrets({ safeStorage, filePath: keyPath });

    if (state.secrets.hasKey()) {
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
      summaryKeys: state.config.summaryKeys,
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
      summarize,
      typer,
      tray: state.tray,
      getApiKey: () => state.secrets.getKey(),
      getConfig: () => state.config,
      notify,
      minDurationMs: 200,
      minHoldMs: 1000,
      sampleRate: 16000,
    });
    state.controller.start();

    if (!state.secrets.hasKey()) {
      notify("VoiceTyper", "Set your Mistral API key in Settings (tray icon → Settings).");
    }

    // --- Settings IPC ---
    ipcMain.handle("settings:get", async () => {
      if (state.secrets.hasKey()) await modelsReady();
      return {
        config: state.config,
        hasKey: state.secrets.hasKey(),
        keys: KEYS,
        models: state.models,
        modelsError: state.modelsError,
      };
    });

    ipcMain.handle("settings:save", async (_e, { config, apiKey }) => {
      const candidate = configModule.mergeConfig(config);
      // mergeConfig silently disables an invalid chord; re-check the raw input so
      // the user is told why rather than finding the chord quietly switched off.
      const chordError = configModule.summaryKeysError(
        candidate.recordKey,
        config && config.summaryKeys
      );
      if (chordError) return { ok: false, error: chordError };

      state.config = candidate;
      configModule.saveConfig(configPath, state.config);

      const keyChanged = typeof apiKey === "string" && apiKey.length > 0;
      if (keyChanged) state.secrets.setKey(apiKey);

      app.setLoginItemSettings({ openAtLogin: state.config.autoLaunch });
      state.hotkey.setBindings({
        recordKey: state.config.recordKey,
        summaryKeys: state.config.summaryKeys,
      });
      state.controller.refreshKeyState();

      if (keyChanged) {
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
