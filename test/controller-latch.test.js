import { describe, it, expect } from "vitest";
import EventEmitter from "events";
import { Controller } from "../src/main/controller.js";

function wavOfMs(ms, sampleRate = 16000) {
  const samples = Math.round((ms / 1000) * sampleRate);
  return new Uint8Array(44 + samples * 2);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(overrides = {}) {
  const hotkey = new EventEmitter();
  let wavCb = () => {};
  const recorder = {
    starts: [],
    stops: 0,
    start(opts) { this.starts.push(opts); },
    stop() { this.stops++; },
    onWav(cb) { wavCb = cb; },
    onChunk() {},
  };
  let nowMs = 0;
  const advance = (ms) => { nowMs += ms; };
  const typed = [];
  const notifications = [];
  const clipboard = [];
  const sessions = [];
  const openWaits = [];
  const config = {
    model: "voxtral-mini-transcribe-3",
    language: "auto",
    summaryModel: "mistral-small-latest",
    summaryPrompt: "Be terse.",
    separator: "blank-line",
    ...overrides.config,
  };
  const controller = new Controller({
    hotkey,
    recorder,
    transcribe: async () => "text",
    googleTranscribe: async () => "google-text",
    microsoftTranscribe: () => new Promise(() => {}),
    summarize: async () => "summary",
    googleSummarize: async () => "google-summary",
    openMicrosoftStream: (opts) => {
      const session = {
        append() {},
        cancel() {},
        finish: () => new Promise(() => {}),
        delta: (text) => opts.onDelta(text),
      };
      sessions.push(session);
      return session;
    },
    typer: {
      type: async (t) => typed.push(t),
      typeParts: async (parts, separator) => typed.push({ parts, separator }),
    },
    tray: { setState() {} },
    getApiKey: () => "key",
    getGoogleApiKey: () => "google-key",
    getMicrosoftApiKey: () => "ms-key",
    getConfig: () => config,
    notify: (_title, body) => notifications.push(body),
    copyToClipboard: (t) => clipboard.push(t),
    wait: () => new Promise((resolve) => openWaits.push(resolve)),
    minDurationMs: 200,
    minHoldMs: 1000,
    now: () => nowMs,
    sampleRate: 16000,
  });
  controller.start();

  // A press of `holdMs`, `gapMs` after the release before it.
  const press = (holdMs, { gapMs = 200, mode = "transcript" } = {}) => {
    advance(gapMs);
    hotkey.emit("record-start");
    advance(holdMs);
    hotkey.emit("record-stop", { mode });
  };
  // The audio of the capture that just stopped arrives.
  const fireWav = (ms) => wavCb(wavOfMs(ms), recorder.starts.at(-1).id);
  // The recorder sends the audio of each tap, as the real one does.
  const tripleTap = () => {
    advance(1000);
    press(100);
    fireWav(100);
    press(100);
    fireWav(100);
    press(100);
  };

  return {
    controller,
    hotkey,
    recorder,
    typed,
    notifications,
    clipboard,
    sessions,
    advance,
    press,
    tripleTap,
    fireWav,
    endWaits: async () => {
      openWaits.splice(0).forEach((resolve) => resolve());
      await flush();
    },
  };
}

describe("Controller triple tap", () => {
  it("keeps the recording of the third tap running after the release", () => {
    const h = harness();

    h.tripleTap();

    expect(h.recorder.starts).toHaveLength(3);
    expect(h.recorder.stops).toBe(2);
    expect(h.controller.isRecording()).toBe(true);
    expect(h.notifications).toEqual(["Recording — tap the record key to stop"]);
  });

  it("stops with the next tap and types the transcript", async () => {
    const h = harness();
    h.tripleTap();

    h.press(100, { gapMs: 5000 });
    h.fireWav(5200);
    await flush();

    expect(h.recorder.starts).toHaveLength(3);
    expect(h.recorder.stops).toBe(3);
    expect(h.controller.isRecording()).toBe(false);
    expect(h.typed).toEqual(["text"]);
  });

  it("adds a summary when the stopping tap asks for one", async () => {
    const h = harness();
    h.tripleTap();

    h.press(100, { gapMs: 5000, mode: "summary" });
    h.fireWav(5200);
    await flush();

    expect(h.typed).toEqual([{ parts: ["text", "summary"], separator: "blank-line" }]);
  });

  it("types nothing when the recording is stopped before the minimum length", async () => {
    const h = harness();
    h.tripleTap();

    h.press(100, { gapMs: 300 });
    h.fireWav(500);
    await flush();

    expect(h.typed).toEqual([]);
    expect(h.controller.isRecording()).toBe(false);
  });

  it("does not copy the transcripts of the last dictation", async () => {
    const h = harness();
    h.press(1200);
    h.fireWav(1200);
    await flush();

    h.tripleTap();
    await h.endWaits();

    expect(h.clipboard).toEqual([]);
  });

  it("does not start for three taps that are too slow", () => {
    const h = harness();

    h.press(100);
    h.press(100, { gapMs: 500 });
    h.press(100, { gapMs: 500 });

    expect(h.controller.isRecording()).toBe(false);
    expect(h.recorder.stops).toBe(3);
  });

  it("does not start when the third press is a hold", async () => {
    const h = harness();

    h.press(100);
    h.press(100);
    h.press(1200);
    h.fireWav(1200);
    await flush();

    expect(h.controller.isRecording()).toBe(false);
    expect(h.typed).toEqual(["text"]);
  });

  it("records with a normal hold again after the recording was stopped", async () => {
    const h = harness();
    h.tripleTap();
    h.press(100, { gapMs: 5000 });
    h.fireWav(5200);
    await flush();

    h.press(1200, { gapMs: 2000 });
    h.fireWav(1200);
    await flush();

    expect(h.recorder.starts).toHaveLength(4);
    expect(h.typed).toEqual(["text", "text"]);
  });

  it("needs three new taps to start again", async () => {
    const h = harness();
    h.tripleTap();
    h.press(100, { gapMs: 5000 });
    h.fireWav(5200);
    await flush();

    h.press(100);

    expect(h.controller.isRecording()).toBe(false);
  });

  it("types Microsoft live text while the recording runs", async () => {
    const h = harness({
      config: { transcriptionModels: ["microsoft"], microsoftEndpoint: "https://res.services.ai.azure.com" },
    });
    h.tripleTap();

    h.advance(2000);
    h.sessions.at(-1).delta("live text");
    await flush();

    expect(h.typed).toEqual(["live text"]);
  });
});
