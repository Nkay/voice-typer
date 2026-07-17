import { describe, it, expect } from "vitest";
import path from "path";
import os from "os";
import { boot } from "../src/main/boot.js";

function fakeDeps() {
  const captured = { readyCb: null, tray: null };

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
      return false;
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
      getPath: () => path.join(os.tmpdir(), "voicetyper-boot-test"),
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
    ipcMain: { on: () => {}, handle: () => {} },
    Notification: FakeNotification,
    GlobalKeyboardListener: class {
      addListener() {}
      kill() {}
    },
    keyboard: { config: {} },
    Key: {},
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
});
