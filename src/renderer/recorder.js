let audioContext = null;
let workletNode = null;
let mediaStream = null;
let sourceNode = null;
let chunks = [];
let recording = false;

async function startCapture(opts) {
  if (recording) return;
  recording = true;
  chunks = [];

  const constraints = {
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      ...(opts && opts.micDeviceId ? { deviceId: { ideal: opts.micDeviceId } } : {}),
    },
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  // A stop may have arrived while getUserMedia was pending; if so, tear down and bail.
  if (!recording) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }
  mediaStream = stream;
  audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule("recorder-worklet.js");
  // A stop may have arrived while the worklet module was loading.
  if (!recording) {
    cleanup();
    return;
  }
  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioContext, "recorder-processor");
  workletNode.port.onmessage = (e) => {
    if (recording) chunks.push(e.data);
  };
  sourceNode.connect(workletNode);
  // Do not connect to destination — we must not play the mic back.
}

function stopCapture() {
  if (!recording) return;
  recording = false;

  const sampleRate = audioContext ? audioContext.sampleRate : 48000;
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  chunks = [];

  window.capture.sendPcm(merged.buffer, sampleRate);
  cleanup();
}

function cleanup() {
  if (sourceNode) sourceNode.disconnect();
  if (workletNode) workletNode.disconnect();
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  if (audioContext) audioContext.close();
  audioContext = workletNode = mediaStream = sourceNode = null;
}

window.capture.onStart((opts) =>
  startCapture(opts).catch((err) => {
    console.error(err);
    recording = false;
    cleanup();
  })
);
window.capture.onStop(() => stopCapture());
