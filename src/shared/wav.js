function resample(input, inRate, outRate) {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = idx - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

// Signed 16-bit little-endian mono PCM, without a header: the body of a WAV
// file, and the raw format the Microsoft realtime API expects.
function toPcm16(samples, inputSampleRate, targetSampleRate = 16000) {
  const pcm = resample(samples, inputSampleRate, targetSampleRate);
  const out = new Uint8Array(pcm.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

function encodeWav(samples, inputSampleRate, targetSampleRate = 16000) {
  const body = toPcm16(samples, inputSampleRate, targetSampleRate);
  const out = new Uint8Array(44 + body.length);
  const view = new DataView(out.buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  const byteRate = targetSampleRate * 2; // mono, 16-bit
  writeString(0, "RIFF");
  view.setUint32(4, 36 + body.length, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, body.length, true);
  out.set(body, 44);
  return out;
}

module.exports = { resample, toPcm16, encodeWav };
