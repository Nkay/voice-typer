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
  GlobalKeyboardListener,
  keyboard,
  Key,
}) {
  // Slow the synthetic typing slightly so target apps keep up.
  keyboard.config.autoDelayMs = 2;

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  let state = {};

  const notify = (title, body) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
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
      height: 380,
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
      keyName: state.config.recordKey,
      createListener: () => new GlobalKeyboardListener(),
    });
    state.hotkey.start();

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
      typer,
      tray: state.tray,
      getApiKey: () => state.secrets.getKey(),
      getConfig: () => state.config,
      notify,
      minDurationMs: 200,
      sampleRate: 16000,
    });
    state.controller.start();

    if (!state.secrets.hasKey()) {
      notify("VoiceTyper", "Set your Mistral API key in Settings (tray icon → Settings).");
    }

    // --- Settings IPC ---
    ipcMain.handle("settings:get", () => ({
      config: state.config,
      hasKey: state.secrets.hasKey(),
    }));

    ipcMain.handle("settings:save", (_e, { config, apiKey }) => {
      state.config = configModule.mergeConfig(config);
      configModule.saveConfig(configPath, state.config);
      if (typeof apiKey === "string" && apiKey.length > 0) state.secrets.setKey(apiKey);
      app.setLoginItemSettings({ openAtLogin: state.config.autoLaunch });
      state.hotkey.setKey(state.config.recordKey);
      state.controller.refreshKeyState();
      return { ok: true };
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
