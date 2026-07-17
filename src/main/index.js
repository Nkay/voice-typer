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

const { GlobalKeyboardListener } = require("node-global-key-listener");
const { keyboard, Key } = require("@nut-tree-fork/nut-js");

const { boot } = require("./boot.js");

boot({
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
});
