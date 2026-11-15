const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("settingsAPI", {
  get: () => ipcRenderer.invoke("settings:get"),
  save: (payload) => ipcRenderer.invoke("settings:save", payload),
  chooseDictionary: () => ipcRenderer.invoke("dictionary:choose"),
  createDictionary: () => ipcRenderer.invoke("dictionary:create"),
  openDictionary: (path) => ipcRenderer.invoke("dictionary:open", path),
  describeDictionary: (path) => ipcRenderer.invoke("dictionary:describe", path),
});
