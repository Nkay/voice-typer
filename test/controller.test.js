import { describe, it, expect } from "vitest";
import EventEmitter from "events";
import { Controller } from "../src/main/controller.js";
import { TranscriberError } from "../src/shared/transcriber.js";

function wavOfMs(ms, sampleRate = 16000) {
  const samples = Math.round((ms / 1000) * sampleRate);
  return new Uint8Array(44 + samples * 2);
}

function harness(overrides = {}) {
  const hotkey = new EventEmitter();
  let wavCb = () => {};
  const recorder = {
    started: 0,
    stopped: 0,
    start() { this.started++; },
    stop() { this.stopped++; },
    onWav(cb) { wavCb = cb; },
  };
  const typed = [];
  const states = [];
  const notifications = [];
  let nowMs = 0;
  const deps = {
    hotkey,
    recorder,
    transcribe: overrides.transcribe || (async () => "text"),
    typer: { type: async (t) => typed.push(t) },
    tray: { setState: (s) => states.push(s) },
    getApiKey: overrides.getApiKey || (() => "key"),
    getConfig: () => ({ model: "voxtral-mini-latest", language: "auto" }),
    notify: (t, b) => notifications.push([t, b]),
    minDurationMs: 200,
    minHoldMs: 1000,
    now: () => nowMs,
    sampleRate: 16000,
  };
  const controller = new Controller(deps);
  return {
    controller,
    hotkey,
    recorder,
    fireWav: (b) => wavCb(b),
    typed,
    states,
    notifications,
    advance: (ms) => { nowMs += ms; },
  };
}

describe("Controller", () => {
  it("records on key hold and transcribes+types on a valid clip", async () => {
    const h = harness();
    h.controller.start();
    h.hotkey.emit("record-start");
    expect(h.recorder.started).toBe(1);
    expect(h.states).toContain("recording");
    h.advance(1200);
    h.hotkey.emit("record-stop");
    expect(h.recorder.stopped).toBe(1);
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.states).toContain("processing");
    expect(h.typed).toEqual(["text"]);
    expect(h.states[h.states.length - 1]).toBe("active");
  });

  it("skips clips shorter than minDurationMs", async () => {
    const h = harness();
    h.controller.start();
    h.fireWav(wavOfMs(50));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.typed).toEqual([]);
    expect(h.states).not.toContain("processing");
  });

  it("ignores record-start while paused", () => {
    const h = harness();
    h.controller.start();
    h.controller.setPaused(true);
    h.hotkey.emit("record-start");
    expect(h.recorder.started).toBe(0);
    expect(h.states[h.states.length - 1]).toBe("paused");
  });

  it("shows error state and notifies on transcription failure", async () => {
    const h = harness({ transcribe: async () => { throw new TranscriberError("UNAUTHORIZED", "bad"); } });
    h.controller.start();
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.states).toContain("error");
    expect(h.notifications.length).toBe(1);
  });

  it("processes queued clips in FIFO order", async () => {
    const order = [];
    let resolvers = [];
    const transcribe = (bytes) =>
      new Promise((resolve) => resolvers.push(() => resolve(`t${bytes.length}`)));
    const h = harness({ transcribe });
    h.controller.start();
    const a = wavOfMs(1000);
    const b = wavOfMs(2000);
    h.fireWav(a);
    h.fireWav(b);
    await new Promise((r) => setTimeout(r, 0));
    resolvers[0](); // resolve first
    await new Promise((r) => setTimeout(r, 0));
    resolvers[1](); // resolve second
    await new Promise((r) => setTimeout(r, 0));
    expect(h.typed).toEqual([`t${a.length}`, `t${b.length}`]);
  });

  it("starts in error state when no API key is set", () => {
    const h = harness({ getApiKey: () => null });
    h.controller.start();
    expect(h.states[h.states.length - 1]).toBe("error");
  });

  it("recovers the queue after tray.setState throws mid-processing", async () => {
    const hotkey = new EventEmitter();
    let wavCb = () => {};
    const recorder = { onWav(cb) { wavCb = cb; } };
    const typed = [];
    const states = [];
    let processingCalls = 0;
    const tray = {
      setState(s) {
        if (s === "processing") {
          processingCalls++;
          if (processingCalls === 1) {
            throw new Error("tray boom");
          }
        }
        states.push(s);
      },
    };
    const controller = new Controller({
      hotkey,
      recorder,
      transcribe: async () => "ok",
      typer: { type: async (t) => typed.push(t) },
      tray,
      getApiKey: () => "k",
      getConfig: () => ({ model: "m", language: "auto" }),
      notify: () => {},
      minDurationMs: 200,
      sampleRate: 16000,
    });

    controller.start();
    wavCb(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));
    wavCb(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));

    // The first clip's tray update threw; the queue must not deadlock, so
    // the second clip should still be transcribed and typed.
    expect(typed).toContain("ok");
  });

  it("discards clips when the key was held shorter than minHoldMs", async () => {
    const h = harness();
    h.controller.start();
    h.hotkey.emit("record-start");
    h.advance(400);
    h.hotkey.emit("record-stop");
    // 400ms of audio passes the minDurationMs (200ms) guard — only the
    // hold guard can discard this clip.
    h.fireWav(wavOfMs(400));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.typed).toEqual([]);
    expect(h.states).not.toContain("processing");
    expect(h.states[h.states.length - 1]).toBe("active");
  });

  it("transcribes when the hold exceeds minHoldMs even if the audio is shorter", async () => {
    const h = harness();
    h.controller.start();
    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop");
    // Mic spin-up delays capture: a 1.2s hold produced only 800ms of
    // audio. Hold length is what counts.
    h.fireWav(wavOfMs(800));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.typed).toEqual(["text"]);
  });

  it("does not let a short hold discard the next full-length clip", async () => {
    const h = harness();
    h.controller.start();
    h.hotkey.emit("record-start");
    h.advance(400);
    h.hotkey.emit("record-stop");
    h.fireWav(wavOfMs(400));
    await new Promise((r) => setTimeout(r, 0));
    h.hotkey.emit("record-start");
    h.advance(1500);
    h.hotkey.emit("record-stop");
    h.fireWav(wavOfMs(1200));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.typed).toEqual(["text"]);
  });
});
