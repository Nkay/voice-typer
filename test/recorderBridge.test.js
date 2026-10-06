import { describe, it, expect } from "vitest";
import { encodeWav } from "../src/shared/wav.js";
import { createRecorderBridge } from "../src/main/recorderBridge.js";

describe("recorderBridge", () => {
  it("sends capture:start with the injected start opts, and capture:stop", () => {
    const sent = [];
    const bridge = createRecorderBridge({
      send: (ch, ...a) => sent.push([ch, ...a]),
      encodeWav,
      getStartOpts: () => ({ micDeviceId: "abc" }),
    });
    bridge.start();
    bridge.stop();
    expect(sent[0]).toEqual(["capture:start", { micDeviceId: "abc" }]);
    expect(sent[1][0]).toBe("capture:stop");
  });

  it("sends an empty start opts object when no getStartOpts is provided", () => {
    const sent = [];
    const bridge = createRecorderBridge({ send: (ch, ...a) => sent.push([ch, ...a]), encodeWav });
    bridge.start();
    expect(sent[0]).toEqual(["capture:start", {}]);
  });

  it("encodes incoming PCM into a WAV and emits it", () => {
    let got = null;
    const bridge = createRecorderBridge({ send: () => {}, encodeWav });
    bridge.onWav((wav) => (got = wav));
    const pcm = new Float32Array(320); // 320 @ 32k -> 160 @ 16k
    bridge.handlePcm(pcm.buffer, 32000);
    expect(got).toBeInstanceOf(Uint8Array);
    expect(got.length).toBe(44 + 160 * 2);
  });

  it("merges start opts from the caller over the injected ones", () => {
    const sent = [];
    const bridge = createRecorderBridge({
      send: (ch, ...a) => sent.push([ch, ...a]),
      encodeWav,
      getStartOpts: () => ({ micDeviceId: "abc" }),
    });
    bridge.start({ stream: true, id: 7 });
    expect(sent[0]).toEqual(["capture:start", { micDeviceId: "abc", stream: true, id: 7 }]);
  });

  it("passes the capture id along with the WAV", () => {
    let got = null;
    const bridge = createRecorderBridge({ send: () => {}, encodeWav });
    bridge.onWav((wav, id) => (got = id));
    bridge.handlePcm(new Float32Array(320).buffer, 16000, 3);
    expect(got).toBe(3);
  });

  it("turns a streamed chunk into 16 kHz PCM16 without a header", () => {
    let got = null;
    const bridge = createRecorderBridge({ send: () => {}, encodeWav });
    bridge.onChunk((pcm, id) => (got = { pcm, id }));
    const floats = new Float32Array(480).fill(0.5); // 480 @ 48k -> 160 @ 16k
    bridge.handleChunk(floats.buffer, 48000, 5);
    expect(got.id).toBe(5);
    expect(got.pcm.length).toBe(160 * 2);
    const view = new DataView(got.pcm.buffer);
    expect(view.getInt16(0, true)).toBe(Math.trunc(0.5 * 0x7fff));
  });

  it("skips an empty chunk", () => {
    let calls = 0;
    const bridge = createRecorderBridge({ send: () => {}, encodeWav });
    bridge.onChunk(() => calls++);
    bridge.handleChunk(new Float32Array(0).buffer, 48000, 1);
    expect(calls).toBe(0);
  });
});
