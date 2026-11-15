import { describe, it, expect } from "vitest";
import fs from "fs";
import vm from "vm";

const source = fs.readFileSync(new URL("../src/renderer/recorder.js", import.meta.url), "utf8");
const flush = () => new Promise((r) => setTimeout(r, 0));

// Runs the recorder page script with fakes for the browser audio API. Each
// getUserMedia call stays open until the test opens or fails that microphone.
function loadRecorder() {
  const mics = [];
  const contexts = [];
  const nodes = [];
  const sent = [];
  const handlers = {};

  class FakeAudioContext {
    constructor() {
      this.sampleRate = 48000;
      this.closed = false;
      this.audioWorklet = { addModule: async () => {} };
      contexts.push(this);
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    close() {
      this.closed = true;
    }
  }
  class FakeWorkletNode {
    constructor() {
      this.port = {};
      nodes.push(this);
    }
    disconnect() {}
    // One block of audio from the microphone.
    feed(samples) {
      this.port.onmessage({ data: new Float32Array(samples) });
    }
  }

  vm.runInNewContext(source, {
    navigator: {
      mediaDevices: {
        getUserMedia: () =>
          new Promise((resolve, reject) => {
            const stream = { stopped: false };
            stream.getTracks = () => [{ stop: () => (stream.stopped = true) }];
            mics.push({ stream, open: () => resolve(stream), fail: reject });
          }),
      },
    },
    AudioContext: FakeAudioContext,
    AudioWorkletNode: FakeWorkletNode,
    window: {
      capture: {
        onStart: (cb) => (handlers.start = cb),
        onStop: (cb) => (handlers.stop = cb),
        sendPcm: (buffer, _sampleRate, id) => sent.push({ id, samples: buffer.byteLength / 4 }),
        sendChunk: () => {},
      },
    },
    console: { error: () => {} },
  });

  return { mics, contexts, nodes, sent, start: (id) => handlers.start({ id }), stop: () => handlers.stop() };
}

describe("recorder page", () => {
  it("records one capture and sends its audio at the stop", async () => {
    const r = loadRecorder();
    r.start(1);
    r.mics[0].open();
    await flush();

    r.nodes[0].feed(128);
    r.nodes[0].feed(128);
    r.stop();

    expect(r.sent).toEqual([{ id: 1, samples: 256 }]);
    expect(r.mics[0].stream.stopped).toBe(true);
    expect(r.contexts[0].closed).toBe(true);
  });

  it("releases a capture that was stopped before its microphone opened, also when a new capture runs", async () => {
    const r = loadRecorder();
    r.start(1);
    r.stop();
    r.start(2);

    r.mics[0].open();
    r.mics[1].open();
    await flush();

    expect(r.mics[0].stream.stopped).toBe(true);
    expect(r.mics[1].stream.stopped).toBe(false);
    expect(r.nodes).toHaveLength(1);

    r.nodes[0].feed(128);
    r.stop();

    expect(r.sent).toEqual([
      { id: 1, samples: 0 },
      { id: 2, samples: 128 },
    ]);
    expect(r.mics[1].stream.stopped).toBe(true);
  });

  it("keeps a new capture when the microphone of an old one fails late", async () => {
    const r = loadRecorder();
    r.start(1);
    r.stop();
    r.start(2);
    r.mics[1].open();
    await flush();

    r.mics[0].fail(new Error("microphone busy"));
    await flush();
    r.nodes[0].feed(128);
    r.stop();

    expect(r.sent).toEqual([
      { id: 1, samples: 0 },
      { id: 2, samples: 128 },
    ]);
  });

  it("releases a capture that was stopped while the worklet loaded", async () => {
    const r = loadRecorder();
    r.start(1);
    r.mics[0].open();
    r.stop();
    await flush();

    expect(r.mics[0].stream.stopped).toBe(true);
    expect(r.contexts.every((context) => context.closed)).toBe(true);
    expect(r.nodes).toHaveLength(0);
  });

  it("sends no audio for a capture whose microphone failed", async () => {
    const r = loadRecorder();
    r.start(1);
    r.mics[0].fail(new Error("no microphone"));
    await flush();

    r.stop();

    expect(r.sent).toEqual([]);
  });
});
