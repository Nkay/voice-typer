class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // Copy the mono channel; postMessage transfers a fresh buffer each block.
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}
registerProcessor("recorder-processor", RecorderProcessor);
