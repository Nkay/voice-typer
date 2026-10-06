const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  safeStorage,
  ipcMain,
  Notification,
  clipboard,
} = require("electron");

const { keyboard, Key } = require("@nut-tree-fork/nut-js");

const { boot } = require("./boot.js");
const { createKeyPoller, createWin32KeyState, createModifierProbe } = require("./keyPoller.js");

// Created by the hotkey listener, so a koffi load failure still takes boot's
// "Hotkey listener failed to start" path instead of crashing here. The typing
// guard shares the same reader.
let getKeyState = null;
const modifierProbe = createModifierProbe((vk) => getKeyState(vk));

boot({
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  safeStorage,
  ipcMain,
  Notification,
  createListener: (keys) => {
    getKeyState = createWin32KeyState();
    return createKeyPoller({ getKeyState, keys });
  },
  isModifierDown: () => getKeyState !== null && modifierProbe(),
  clipboard,
  keyboard,
  Key,
});
