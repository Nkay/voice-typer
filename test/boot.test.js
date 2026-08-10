import { describe, it, expect } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";
import { boot } from "../src/main/boot.js";

function fakeDeps() {
  // Memoized so it returns the SAME directory every time app.getPath("userData")
  // is called within one boot() — letting a test pre-write a key.enc at a path
  // it can predict — while still being a fresh, unique directory per test.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicetyper-boot-"));
  const captured = {
    readyCb: null,
    tray: null,
    notifications: [],
    handlers: {},
    userDataDir,
    setKeysCalls: [],
  };

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
      getPath: () => userDataDir,
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
    createListener: () => ({
      addListener() {},
      setKeys: (names) => captured.setKeysCalls.push(names),
      kill() {},
    }),
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

  it("settings:save rejects a chord that collides with the record key and saves nothing", async () => {
    const { deps, captured } = fakeDeps();
    boot(deps);
    captured.readyCb();

    const result = await captured.handlers["settings:save"](null, {
      config: { recordKey: "LEFT CTRL", summaryKeys: ["LEFT CTRL", "LEFT SHIFT"] },
      apiKey: "sk-should-not-be-saved",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/record key/i);

    const after = await captured.handlers["settings:get"]();
    expect(after.config.recordKey).toBe("RIGHT ALT");

    // "Saves nothing" means all the way down: no config file, no persisted
    // API key, and the hotkey listener was never re-targeted.
    expect(fs.existsSync(path.join(captured.userDataDir, "config.json"))).toBe(false);
    expect(fs.existsSync(path.join(captured.userDataDir, "key.enc"))).toBe(false);
    expect(captured.setKeysCalls).toEqual([]);
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

  it("fetches models once at startup when a key already exists, and settings:get joins the in-flight fetch instead of starting a second one", async () => {
    const { deps, captured } = fakeDeps();
    // A key.enc written exactly as secrets.js/setKey + the fake safeStorage
    // would produce it, so secrets.hasKey() is true when boot runs.
    fs.writeFileSync(path.join(captured.userDataDir, "key.enc"), Buffer.from("test-api-key"));

    let fetchCalls = 0;
    let resolveFetch;
    deps.fetchChatModels = () => {
      fetchCalls++;
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    };

    boot(deps);
    captured.readyCb();
    expect(fetchCalls).toBe(1);

    // settings:get fires while the startup fetch is still pending.
    const pending = captured.handlers["settings:get"]();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchCalls).toBe(1); // joined, not duplicated

    resolveFetch(["mistral-large-latest", "mistral-small-latest"]);
    const result = await pending;

    expect(fetchCalls).toBe(1);
    expect(result.models).toEqual(["mistral-large-latest", "mistral-small-latest"]);
    expect(result.modelsError).toBeNull();
  });

  it("does not let a failed startup fetch poison later attempts (Fix 1 regression)", async () => {
    const { deps, captured } = fakeDeps();
    fs.writeFileSync(path.join(captured.userDataDir, "key.enc"), Buffer.from("test-api-key"));

    let calls = 0;
    deps.fetchChatModels = async () => {
      calls++;
      if (calls === 1) throw new Error("offline at launch");
      return ["mistral-large-latest"];
    };

    boot(deps);
    captured.readyCb();
    // Let the startup fetch's rejection be observed and the memo cleared.
    await new Promise((r) => setTimeout(r, 0));

    const result = await captured.handlers["settings:get"]();

    expect(calls).toBe(2);
    expect(result.models).toEqual(["mistral-large-latest"]);
    expect(result.modelsError).toBeNull();
  });
});
