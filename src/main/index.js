const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  safeStorage,
  ipcMain,
  Notification,
} = require("electron");

const { keyboard, Key } = require("@nut-tree-fork/nut-js");

const { boot } = require("./boot.js");
const { createKeyPoller, createWin32KeyState } = require("./keyPoller.js");

boot({
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  safeStorage,
  ipcMain,
  Notification,
  createListener: (keys) => createKeyPoller({ getKeyState: createWin32KeyState(), keys }),
  keyboard,
  Key,
});
