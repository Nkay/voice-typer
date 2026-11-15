const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("historyAPI", {
  get: () => ipcRenderer.invoke("history:get"),
  clear: () => ipcRenderer.invoke("history:clear"),
  // The main process sends the full list again after each change.
  onChanged: (cb) => ipcRenderer.on("history:changed", (_e, list) => cb(list)),
});
