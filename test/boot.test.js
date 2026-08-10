import { describe, it, expect } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";
import { boot } from "../src/main/boot.js";

function fakeDeps() {
  const captured = { readyCb: null, tray: null, notifications: [], handlers: {} };

  class FakeBrowserWindow {
    constructor() {
      this.webContents = { send: () => {} };
    }
    loadFile() {}
    setMenuBarVisibility() {}
    focus() {}
    isDestroyed() {
      return false;
    }
  }
  class FakeTray {
    constructor() {
      captured.tray = this;
      this.menus = [];
    }
    setContextMenu(menu) {
      this.menus.push(menu);
    }
    setImage() {}
    setToolTip() {}
    destroy() {}
  }
  class FakeNotification {
    static isSupported() {
      return true;
    }
    constructor(opts) {
      captured.notifications.push(opts);
    }
    show() {}
  }

  const deps = {
    app: {
      requestSingleInstanceLock: () => true,
      // Thenable instead of a real promise so tests can run the ready
      // callback synchronously and observe a throw instead of an
      // unhandled rejection.
      whenReady: () => ({ then: (cb) => (captured.readyCb = cb) }),
      getPath: () => fs.mkdtempSync(path.join(os.tmpdir(), "voicetyper-boot-")),
      setLoginItemSettings: () => {},
      on: () => {},
      quit: () => {},
    },
    BrowserWindow: FakeBrowserWindow,
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromPath: () => ({}) },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => String(b),
    },
    ipcMain: {
      on: () => {},
      handle: (channel, handler) => (captured.handlers[channel] = handler),
    },
    Notification: FakeNotification,
    createListener: () => ({ addListener() {}, setKeys() {}, kill() {} }),
    keyboard: { config: {} },
    Key: { LeftShift: "LeftShift", Enter: "Enter" },
    fetchChatModels: async () => ["mistral-large-latest", "mistral-small-latest"],
  };
  return { deps, captured };
}

describe("boot wiring", () => {
  it("runs the ready sequence without throwing and attaches a tray menu", () => {
    const { deps, captured } = fakeDeps();
    boot(deps);
    expect(captured.readyCb).toBeTypeOf("function");

    expect(() => captured.readyCb()).not.toThrow();

    const menu = captured.tray.menus.at(-1);
    expect(menu).toBeDefined();
    const labels = menu.map((item) => item.label);
    expect(labels).toContain("Settings…");
    expect(labels).toContain("Quit");
    expect(menu.find((item) => item.label === "Paused").checked).toBe(false);
  });

  it("toggling pause from the tray menu rebuilds it with the new state", () => {
    const { deps, captured } = fakeDeps();
    boot(deps);
    captured.readyCb();

    const pauseItem = captured.tray.menus.at(-1).find((item) => item.label === "Paused");
    pauseItem.click();

    const rebuilt = captured.tray.menus.at(-1).find((item) => item.label === "Paused");
    expect(rebuilt.checked).toBe(true);
  });

  it("keeps booting and notifies when the hotkey listener fails to start", () => {
    const { deps, captured } = fakeDeps();
    deps.createListener = () => {
      throw new Error("native listener unavailable");
    };
    boot(deps);

    expect(() => captured.readyCb()).not.toThrow();
    expect(captured.tray.menus.length).toBeGreaterThan(0);
    expect(
      captured.notifications.some(
        (n) => n.body === "Hotkey listener failed to start — recording is disabled."
      )
    ).toBe(true);
  });

  it("settings:get returns the key catalog", async () => {
    const { deps, captured } = fakeDeps();
    boot(deps);
    captured.readyCb();

    const result = await captured.handlers["settings:get"]();
    expect(Array.isArray(result.keys)).toBe(true);
    expect(result.keys.some((k) => k.name === "RIGHT ALT")).toBe(true);
    expect(result.keys.some((k) => k.name === "F24")).toBe(true);
    expect(result.config.summaryKeys).toEqual(["LEFT CTRL", "LEFT SHIFT"]);
  });

  it("settings:get reports no models and no error when there is no API key", async () => {
    const { deps, captured } = fakeDeps();
    let fetched = 0;
    deps.fetchChatModels = async () => {
      fetched++;
      return [];
    };
    boot(deps);
    captured.readyCb();

    const result = await captured.handlers["settings:get"]();
    expect(result.hasKey).toBe(false);
    expect(result.models).toBeNull();
    expect(result.modelsError).toBeNull();
    expect(fetched).toBe(0);
  });

  it("settings:save rejects a chord that collides with the record key without saving", async () => {
    const { deps, captured } = fakeDeps();
    boot(deps);
    captured.readyCb();

    const result = await captured.handlers["settings:save"](null, {
      config: { recordKey: "LEFT CTRL", summaryKeys: ["LEFT CTRL", "LEFT SHIFT"] },
      apiKey: "",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/record key/i);

    const after = await captured.handlers["settings:get"]();
    expect(after.config.recordKey).toBe("RIGHT ALT");
  });

  it("settings:save accepts a valid chord and reports ok", async () => {
    const { deps, captured } = fakeDeps();
    boot(deps);
    captured.readyCb();

    const result = await captured.handlers["settings:save"](null, {
      config: { recordKey: "RIGHT ALT", summaryKeys: ["F13", "F14"], separator: "dash" },
      apiKey: "",
    });

    expect(result.ok).toBe(true);

    const after = await captured.handlers["settings:get"]();
    expect(after.config.summaryKeys).toEqual(["F13", "F14"]);
    expect(after.config.separator).toBe("dash");
  });

  it("settings:save fetches models once a key is supplied", async () => {
    const { deps, captured } = fakeDeps();
    boot(deps);
    captured.readyCb();

    const result = await captured.handlers["settings:save"](null, {
      config: { recordKey: "RIGHT ALT", summaryKeys: ["F13", "F14"] },
      apiKey: "sk-test",
    });

    expect(result.ok).toBe(true);
    expect(result.models).toEqual(["mistral-large-latest", "mistral-small-latest"]);
    expect(result.modelsError).toBeNull();
  });

  it("records a model fetch failure as a message instead of throwing", async () => {
    const { deps, captured } = fakeDeps();
    deps.fetchChatModels = async () => {
      const err = new Error("Invalid Mistral API key");
      err.code = "UNAUTHORIZED";
      throw err;
    };
    boot(deps);
    captured.readyCb();

    const result = await captured.handlers["settings:save"](null, {
      config: { recordKey: "RIGHT ALT", summaryKeys: ["F13", "F14"] },
      apiKey: "sk-bad",
    });

    expect(result.ok).toBe(true);
    expect(result.models).toBeNull();
    expect(result.modelsError).toMatch(/Invalid Mistral API key/);
  });
});
