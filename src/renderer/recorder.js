let audioContext = null;
let workletNode = null;
let mediaStream = null;
let sourceNode = null;
let chunks = [];
let recording = false;
// Streaming providers get the audio during the hold, in slices of about 50 ms:
// small enough for live text, large enough to keep the IPC traffic low.
let streaming = false;
let streamBlocks = [];
let streamLength = 0;
const STREAM_SLICE_SECONDS = 0.05;
// Echoed with every chunk and the final PCM so the main process can match them
// to the hold that started this capture.
let captureId = null;
// Counts the captures. Opening the microphone takes time, and quick taps can
// stop a capture and start the next one before the first has opened it.
let generation = 0;

async function startCapture(opts) {
  if (recording) return;
  recording = true;
  const mine = ++generation;
  // False once this capture was stopped, also when a newer one runs by now.
  const current = () => recording && mine === generation;
  chunks = [];
  streaming = Boolean(opts && opts.stream);
  captureId = opts && opts.id != null ? opts.id : null;
  streamBlocks = [];
  streamLength = 0;

  const constraints = {
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      ...(opts && opts.micDeviceId ? { deviceId: { ideal: opts.micDeviceId } } : {}),
    },
  };
  // The stream and the context stay local until the capture is set up. The
  // shared variables can belong to a newer capture by then, so a capture that
  // was stopped in the meantime releases only what it opened itself.
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  let context = null;
  const release = () => {
    stream.getTracks().forEach((t) => t.stop());
    if (context) context.close();
  };
  if (!current()) return release();
  context = new AudioContext();
  await context.audioWorklet.addModule("recorder-worklet.js").catch((err) => {
    release();
    throw err;
  });
  if (!current()) return release();
  mediaStream = stream;
  audioContext = context;
  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioContext, "recorder-processor");
  workletNode.port.onmessage = (e) => {
    if (!current()) return;
    chunks.push(e.data);
    if (streaming) {
      streamBlocks.push(e.data);
      streamLength += e.data.length;
      if (streamLength >= audioContext.sampleRate * STREAM_SLICE_SECONDS) flushStream();
    }
  };
  sourceNode.connect(workletNode);
  // Do not connect to destination — we must not play the mic back.
}

function merge(blocks) {
  let total = 0;
  for (const b of blocks) total += b.length;
  const merged = new Float32Array(total);
  let offset = 0;
  for (const b of blocks) {
    merged.set(b, offset);
    offset += b.length;
  }
  return merged;
}

function flushStream() {
  if (streamLength === 0 || !audioContext) return;
  const merged = merge(streamBlocks);
  streamBlocks = [];
  streamLength = 0;
  window.capture.sendChunk(merged.buffer, audioContext.sampleRate, captureId);
}

function stopCapture() {
  if (!recording) return;
  // The last slice must go out before capture:pcm: the main process finishes
  // the stream when the WAV arrives.
  if (streaming) flushStream();
  recording = false;
  streaming = false;

  const sampleRate = audioContext ? audioContext.sampleRate : 48000;
  const merged = merge(chunks);
  chunks = [];

  window.capture.sendPcm(merged.buffer, sampleRate, captureId);
  cleanup();
}

function cleanup() {
  if (sourceNode) sourceNode.disconnect();
  if (workletNode) workletNode.disconnect();
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  if (audioContext) audioContext.close();
  audioContext = workletNode = mediaStream = sourceNode = null;
}

window.capture.onStart((opts) => {
  const run = startCapture(opts);
  // startCapture counts up before its first wait, so this is its own number.
  const mine = generation;
  run.catch((err) => {
    console.error(err);
    // A capture that failed after a newer one started must not stop that one.
    if (mine !== generation) return;
    recording = false;
    cleanup();
  });
});
window.capture.onStop(() => stopCapture());
