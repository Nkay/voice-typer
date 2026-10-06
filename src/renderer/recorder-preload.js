const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("capture", {
  onStart: (cb) => ipcRenderer.on("capture:start", (_e, opts) => cb(opts)),
  onStop: (cb) => ipcRenderer.on("capture:stop", () => cb()),
  sendPcm: (arrayBuffer, sampleRate, captureId) =>
    ipcRenderer.send("capture:pcm", arrayBuffer, sampleRate, captureId),
  sendChunk: (arrayBuffer, sampleRate, captureId) =>
    ipcRenderer.send("capture:chunk", arrayBuffer, sampleRate, captureId),
});
