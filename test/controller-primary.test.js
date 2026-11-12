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
  promise.catch(() => {});
  return { promise, resolve, reject };
}

// Mistral is the primary model and Google the secondary one, unless a test
// says otherwise. The test decides when each model answers and when the wait
// for the primary ends.
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
  const mistral = deferred();
  const google = deferred();
  const sessions = [];
  const typed = [];
  const notifications = [];
  // Each wait the controller starts: its length and the function that ends it.
  const waits = [];
  const history = createTimingHistory({
    filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "voicetyper-cp-")), "timings.json"),
  });
  const config = {
    model: "voxtral-mini-transcribe-3",
    language: "auto",
    summaryModel: "mistral-small-latest",
    summaryPrompt: "Be terse.",
    separator: "blank-line",
    transcriptionModels: ["mistral", "google"],
    primaryModel: "mistral",
    ...overrides.config,
  };
  const controller = new Controller({
    hotkey,
    recorder,
    transcribe: () => mistral.promise,
    googleTranscribe: () => google.promise,
    microsoftTranscribe: () => new Promise(() => {}),
    summarize: async () => "sum",
    googleSummarize: async () => "google-summary",
    openMicrosoftStream: () => {
      const finished = deferred();
      const session = { append() {}, cancel() {}, finish: () => finished.promise, complete: finished.resolve };
      sessions.push(session);
      return session;
    },
    typer: { type: async (t) => typed.push(t), typeParts: async (parts) => typed.push(parts) },
    tray: { setState() {} },
    getApiKey: () => "key",
    getGoogleApiKey: () => "google-key",
    getMicrosoftApiKey: () => "ms-key",
    getConfig: () => config,
    notify: (_title, body) => notifications.push(body),
    copyToClipboard: () => {},
    history,
    wait: (ms) => {
      const d = deferred();
      waits.push({ ms, end: d.resolve });
      return d.promise;
    },
    minDurationMs: 200,
    minHoldMs: 1000,
    now: () => nowMs,
    sampleRate: 16000,
  });
  controller.start();

  // Hold, release and deliver the audio. The requests start right after it.
  const dictate = async () => {
    hotkey.emit("record-start");
    advance(3000);
    hotkey.emit("record-stop", { mode: "transcript" });
    wavCb(wavOfMs(3000), recorder.starts.at(-1).id);
    await flush();
  };

  return { controller, history, mistral, google, sessions, typed, notifications, waits, advance, dictate };
}

describe("Controller primary model", () => {
  it("types the primary text when the primary answers first", async () => {
    const h = harness();
    await h.dictate();

    h.advance(800);
    h.mistral.resolve("primary text");
    await flush();

    expect(h.typed).toEqual(["primary text"]);
    expect(h.waits).toEqual([]);
  });

  it("waits for the primary until 1.5 times the answer time of the secondary", async () => {
    const h = harness();
    await h.dictate();

    h.advance(1000);
    h.google.resolve("secondary text");
    await flush();

    expect(h.typed).toEqual([]);
    expect(h.waits.map((w) => w.ms)).toEqual([500]);
  });

  it("types the primary text when it comes during the wait", async () => {
    const h = harness();
    await h.dictate();
    h.advance(1000);
    h.google.resolve("secondary text");
    await flush();

    h.advance(300);
    h.mistral.resolve("primary text");
    await flush();

    expect(h.typed).toEqual(["primary text"]);
  });

  it("types the secondary text when the wait ends without the primary", async () => {
    const h = harness();
    await h.dictate();
    h.advance(1000);
    h.google.resolve("secondary text");
    await flush();

    h.advance(500);
    h.waits[0].end();
    await flush();

    expect(h.typed).toEqual(["secondary text"]);
  });

  it("does not type the primary text that comes after the secondary text was typed", async () => {
    const h = harness();
    await h.dictate();
    h.advance(1000);
    h.google.resolve("secondary text");
    await flush();
    h.waits[0].end();
    await flush();

    h.mistral.resolve("late primary text");
    await flush();

    expect(h.typed).toEqual(["secondary text"]);
  });

  it("types the secondary text immediately when the primary already failed", async () => {
    const h = harness();
    await h.dictate();
    h.mistral.reject(new TranscriberError("TIMEOUT", "timed out"));
    await flush();

    h.advance(1000);
    h.google.resolve("secondary text");
    await flush();

    expect(h.typed).toEqual(["secondary text"]);
    expect(h.waits).toEqual([]);
    expect(h.notifications).toEqual([]);
  });

  it("stops the wait when the primary fails during it", async () => {
    const h = harness();
    await h.dictate();
    h.advance(1000);
    h.google.resolve("secondary text");
    await flush();

    h.mistral.reject(new TranscriberError("TIMEOUT", "timed out"));
    await flush();

    expect(h.typed).toEqual(["secondary text"]);
  });

  it("types the secondary text when the primary heard nothing", async () => {
    const h = harness();
    await h.dictate();
    h.mistral.resolve("");
    h.google.resolve("secondary text");
    await flush();

    expect(h.typed).toEqual(["secondary text"]);
  });

  it("waits for the primary without a limit when the secondary failed", async () => {
    const h = harness();
    await h.dictate();
    h.google.reject(new Error("boom"));
    await flush();

    h.advance(20000);
    h.mistral.resolve("primary text");
    await flush();

    expect(h.typed).toEqual(["primary text"]);
    expect(h.waits).toEqual([]);
  });

  it("reports the first error when no model gives a text", async () => {
    const h = harness();
    await h.dictate();
    h.mistral.reject(new TranscriberError("TIMEOUT", "timed out"));
    h.google.resolve("");
    await flush();

    expect(h.typed).toEqual([]);
    expect(h.notifications).toEqual(["Mistral transcription timed out"]);
  });

  it("types the fastest text when no primary is selected", async () => {
    const h = harness({ config: { primaryModel: "" } });
    await h.dictate();

    h.google.resolve("secondary text");
    await flush();

    expect(h.typed).toEqual(["secondary text"]);
    expect(h.waits).toEqual([]);
  });

  it("types the fastest text when the primary is not one of the checked models", async () => {
    const h = harness({ config: { primaryModel: "microsoft" } });
    await h.dictate();

    h.google.resolve("secondary text");
    await flush();

    expect(h.typed).toEqual(["secondary text"]);
  });

  it("counts the live Microsoft transcript as an answer of the primary", async () => {
    const h = harness({
      config: {
        transcriptionModels: ["google", "microsoft"],
        primaryModel: "microsoft",
        microsoftEndpoint: "https://res.services.ai.azure.com",
      },
    });
    await h.dictate();
    h.advance(1000);
    h.google.resolve("secondary text");
    await flush();

    h.sessions[0].complete("live primary text");
    await flush();

    expect(h.typed).toEqual(["live primary text"]);
  });

  it("records the wait and which model is the primary in the timing history", async () => {
    const h = harness();
    await h.dictate();
    h.advance(1000);
    h.google.resolve("secondary text");
    await flush();
    h.advance(500);
    h.waits[0].end();
    await flush();

    const [entry] = h.history.list();
    expect(entry.primaryWaitMs).toBe(500);
    expect(entry.models).toEqual([
      { label: "Mistral", ms: null, status: "pending", typed: false, primary: true },
      { label: "Google", ms: 1000, status: "ok", typed: true },
    ]);
  });

  it("records no wait when the primary answers first", async () => {
    const h = harness();
    await h.dictate();
    h.mistral.resolve("primary text");
    await flush();

    expect(h.history.list()[0].primaryWaitMs).toBeNull();
  });
});
