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

async function startCapture(opts) {
  if (recording) return;
  recording = true;
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
    if (!recording) return;
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

window.capture.onStart((opts) =>
  startCapture(opts).catch((err) => {
    console.error(err);
    recording = false;
    cleanup();
  })
);
window.capture.onStop(() => stopCapture());
