import { describe, it, expect } from "vitest";
import { encodeWav, resample } from "../src/shared/wav.js";

function readString(u8, off, len) {
  return String.fromCharCode(...u8.slice(off, off + len));
}

describe("wav", () => {
  it("halves sample count when downsampling 32k -> 16k", () => {
    const input = new Float32Array(320); // 320 @ 32k
    const out = resample(input, 32000, 16000);
    expect(out.length).toBe(160);
  });

  it("writes a valid 44-byte header for 16k mono PCM16", () => {
    const samples = new Float32Array(160); // 160 @ 16k -> stays 160
    const wav = encodeWav(samples, 16000, 16000);
    expect(readString(wav, 0, 4)).toBe("RIFF");
    expect(readString(wav, 8, 4)).toBe("WAVE");
    expect(readString(wav, 12, 4)).toBe("fmt ");
    expect(readString(wav, 36, 4)).toBe("data");
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(wav.length).toBe(44 + 160 * 2);
  });

  it("clamps and converts full-scale samples", () => {
    const wav = encodeWav(new Float32Array([1, -1]), 16000, 16000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
});
