const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("capture", {
  onStart: (cb) => ipcRenderer.on("capture:start", (_e, opts) => cb(opts)),
  onStop: (cb) => ipcRenderer.on("capture:stop", () => cb()),
  sendPcm: (arrayBuffer, sampleRate) =>
    ipcRenderer.send("capture:pcm", arrayBuffer, sampleRate),
});
