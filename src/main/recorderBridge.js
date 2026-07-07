function createRecorderBridge({ send, encodeWav, getStartOpts }) {
  let onWavCb = () => {};
  return {
    start() {
      send("capture:start", getStartOpts ? getStartOpts() : {});
    },
    stop() {
      send("capture:stop");
    },
    onWav(cb) {
      onWavCb = cb;
    },
    handlePcm(arrayBuffer, sampleRate) {
      const floats = new Float32Array(arrayBuffer);
      const wav = encodeWav(floats, sampleRate, 16000);
      onWavCb(wav);
    },
  };
}

module.exports = { createRecorderBridge };
