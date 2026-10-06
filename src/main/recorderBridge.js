const { toPcm16 } = require("../shared/wav.js");

function createRecorderBridge({ send, encodeWav, getStartOpts }) {
  let onWavCb = () => {};
  let onChunkCb = () => {};
  return {
    // `opts.stream` asks the renderer to also send audio while recording, for
    // providers that transcribe during the hold.
    start(opts = {}) {
      send("capture:start", { ...(getStartOpts ? getStartOpts() : {}), ...opts });
    },
    stop() {
      send("capture:stop");
    },
    onWav(cb) {
      onWavCb = cb;
    },
    onChunk(cb) {
      onChunkCb = cb;
    },
    // `captureId` echoes the id passed to start(), so the main process can tell
    // which hold a WAV or chunk belongs to when holds follow each other closely.
    handlePcm(arrayBuffer, sampleRate, captureId) {
      const floats = new Float32Array(arrayBuffer);
      const wav = encodeWav(floats, sampleRate, 16000);
      onWavCb(wav, captureId);
    },
    // A streamed slice of the recording, as 16 kHz PCM16 without a header. The
    // renderer sends every chunk before the final capture:pcm, and Electron
    // keeps one renderer's messages in order, so the last chunk always arrives
    // before the WAV.
    handleChunk(arrayBuffer, sampleRate, captureId) {
      const pcm = toPcm16(new Float32Array(arrayBuffer), sampleRate, 16000);
      if (pcm.length > 0) onChunkCb(pcm, captureId);
    },
  };
}

module.exports = { createRecorderBridge };
