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
});
