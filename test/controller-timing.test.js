import { describe, it, expect } from "vitest";
import EventEmitter from "events";
import os from "os";
import fs from "fs";
import path from "path";
import { Controller } from "../src/main/controller.js";
import { createTimingHistory } from "../src/main/timingHistory.js";
import { TranscriberError } from "../src/shared/transcriber.js";

function wavOfMs(ms, sampleRate = 16000) {
  const samples = Math.round((ms / 1000) * sampleRate);
  return new Uint8Array(44 + samples * 2);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// The clock only moves when a test says so, so every recorded time is exact.
function harness(overrides = {}) {
  const hotkey = new EventEmitter();
  let wavCb = () => {};
  const recorder = {
    starts: [],
    start(opts) { this.starts.push(opts); },
    stop() {},
    onWav(cb) { wavCb = cb; },
    onChunk() {},
  };
  let nowMs = 0;
  const advance = (ms) => { nowMs += ms; };
  const sessions = [];
  const history = createTimingHistory({
    filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "voicetyper-ct-")), "timings.json"),
  });
  const config = {
    model: "voxtral-mini-latest",
    language: "auto",
    summaryModel: "mistral-small-latest",
    summaryPrompt: "Be terse.",
    separator: "blank-line",
    ...overrides.config,
  };
  const type = overrides.type || (async () => advance(500));
  const controller = new Controller({
    hotkey,
    recorder,
    transcribe: overrides.transcribe || (async () => { advance(1200); return "hello"; }),
    googleTranscribe: overrides.googleTranscribe || (async () => "google-text"),
    microsoftTranscribe: async () => new Promise(() => {}),
    summarize: overrides.summarize || (async () => { advance(1800); return "sum"; }),
    googleSummarize: async () => "google-summary",
    openMicrosoftStream: (opts) => {
      const finished = deferred();
      const session = {
        append() {},
        cancel() {},
        finish: () => finished.promise,
        delta: (text) => opts.onDelta(text),
        complete: (text) => finished.resolve(text),
      };
      sessions.push(session);
      return session;
    },
    typer: { type, typeParts: async (parts) => type(parts.join("\n\n")) },
    tray: { setState() {} },
    getApiKey: () => "key",
    getGoogleApiKey: () => "google-key",
    getMicrosoftApiKey: () => "ms-key",
    getConfig: () => config,
    notify: () => {},
    copyToClipboard: () => {},
    history: overrides.history === undefined ? history : overrides.history,
    minDurationMs: 200,
    minHoldMs: 1000,
    now: () => nowMs,
    sampleRate: 16000,
  });
  controller.start();

  // Hold for `holdMs`, release, and deliver the audio `audioMs` later.
  const dictate = ({ holdMs = 3000, audioMs = 80, mode = "transcript" } = {}) => {
    hotkey.emit("record-start");
    advance(holdMs);
    hotkey.emit("record-stop", { mode });
    advance(audioMs);
    wavCb(wavOfMs(holdMs), recorder.starts.at(-1).id);
  };

  return { controller, history, sessions, advance, dictate, now: () => nowMs };
}

describe("Controller timing history", () => {
  it("records how long each step of a dictation took", async () => {
    const h = harness();

    h.dictate({ holdMs: 3000, audioMs: 80 });
    await flush();

    expect(h.history.list()).toEqual([
      {
        at: 3000,
        live: false,
        recordMs: 3000,
        audioMs: 80,
        queueMs: 0,
        models: [{ label: "Mistral", ms: 1200, status: "ok", typed: true }],
        primaryWaitMs: null,
        summaryMs: null,
        summaryFailed: false,
        typingMs: 500,
        chars: 5,
        totalMs: 1780,
      },
    ]);
  });

  it("records every model of a race and which one was typed", async () => {
    const google = deferred();
    const h = harness({
      config: { transcriptionModels: ["mistral", "google"] },
      googleTranscribe: () => google.promise,
    });

    h.dictate();
    await flush();

    expect(h.history.list()[0].models).toEqual([
      { label: "Mistral", ms: 1200, status: "ok", typed: true },
      { label: "Google", ms: null, status: "pending", typed: false },
    ]);

    // Mistral 1200 + typing 500 are over; Google answers 300 ms after that.
    h.advance(300);
    google.resolve("slower text");
    await flush();

    expect(h.history.list()[0].models[1]).toEqual({ label: "Google", ms: 2000, status: "ok", typed: false });
  });

  it("records a model that heard nothing", async () => {
    const h = harness({
      config: { transcriptionModels: ["mistral", "google"] },
      transcribe: async () => "hello",
      googleTranscribe: async () => "",
    });

    h.dictate();
    await flush();

    expect(h.history.list()[0].models[1]).toEqual({ label: "Google", ms: 0, status: "empty", typed: false });
  });

  it("records a failed dictation with the error of each model", async () => {
    const h = harness({
      transcribe: async () => {
        h.advance(10000);
        throw new TranscriberError("TIMEOUT", "timed out");
      },
    });

    h.dictate();
    await flush();

    const [entry] = h.history.list();
    expect(entry.models).toEqual([{ label: "Mistral", ms: 10000, status: "failed", error: "TIMEOUT", typed: false }]);
    expect(entry.typingMs).toBeNull();
    expect(entry.totalMs).toBe(10080);
  });

  it("records the wait behind an earlier dictation", async () => {
    const first = deferred();
    let calls = 0;
    const h = harness({
      transcribe: () => (++calls === 1 ? first.promise : Promise.resolve("second")),
      type: async () => {},
    });

    h.dictate();
    await flush();
    h.dictate();
    h.advance(700);
    first.resolve("first");
    await flush();

    const [second, firstEntry] = h.history.list();
    expect(firstEntry.queueMs).toBe(0);
    expect(second.queueMs).toBe(700);
  });

  it("records the summary step and counts the summary in the typed characters", async () => {
    const h = harness();

    h.dictate({ mode: "summary" });
    await flush();

    const [entry] = h.history.list();
    expect(entry.summaryMs).toBe(1800);
    expect(entry.summaryFailed).toBe(false);
    expect(entry.typingMs).toBe(500);
    // "hello" + blank line + "sum"
    expect(entry.chars).toBe(10);
    expect(entry.totalMs).toBe(80 + 1200 + 1800 + 500);
  });

  it("records a failed summary", async () => {
    const h = harness({
      summarize: async () => {
        h.advance(10000);
        throw new Error("boom");
      },
    });

    h.dictate({ mode: "summary" });
    await flush();

    const [entry] = h.history.list();
    expect(entry.summaryMs).toBe(10000);
    expect(entry.summaryFailed).toBe(true);
    expect(entry.chars).toBe(5);
  });

  it("records a live Microsoft dictation", async () => {
    const h = harness({
      config: {
        transcriptionModels: ["microsoft"],
        microsoftEndpoint: "https://res.services.ai.azure.com",
        microsoftDeployment: "MAI-Transcribe-2-Streaming",
      },
      // Typing takes a moment, so it ends after the final transcript arrived.
      type: async () => {
        await flush();
        h.advance(40);
      },
    });

    h.dictate({ holdMs: 3000, audioMs: 80 });
    await flush();
    h.advance(300);
    h.sessions[0].delta("live text");
    h.sessions[0].complete("live text");
    await flush();

    expect(h.history.list()).toEqual([
      {
        at: 3000,
        live: true,
        recordMs: 3000,
        audioMs: 80,
        queueMs: 0,
        models: [{ label: "Microsoft (live)", ms: 300, status: "ok", typed: true }],
        primaryWaitMs: null,
        summaryMs: null,
        summaryFailed: false,
        typingMs: 40,
        chars: 9,
        totalMs: 420,
      },
    ]);
  });

  it("records nothing for a hold that is too short to count", async () => {
    const h = harness();

    h.dictate({ holdMs: 500 });
    await flush();

    expect(h.history.list()).toEqual([]);
  });

  it("still types when the history fails", async () => {
    const typed = [];
    const h = harness({
      // The file cannot be written and the listener throws.
      history: createTimingHistory({
        filePath: path.join(os.tmpdir(), "voicetyper-missing-dir-xyz", "timings.json"),
        onChange: () => {
          throw new Error("window gone");
        },
      }),
      type: async (t) => typed.push(t),
    });

    h.dictate();
    await flush();
    h.dictate();
    await flush();

    expect(typed).toEqual(["hello", "hello"]);
  });
});
