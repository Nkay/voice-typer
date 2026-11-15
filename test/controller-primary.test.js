import { describe, it, expect } from "vitest";
import EventEmitter from "events";
import os from "os";
import fs from "fs";
import path from "path";
import { Controller } from "../src/main/controller.js";
import { createTimingHistory } from "../src/main/timingHistory.js";
import { TranscriberError } from "../src/shared/transcriber.js";
import { parseDictionary } from "../src/shared/dictionary.js";

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
    ...overrides.deps,
  });
  controller.start();

  // Hold, release and deliver the audio. The requests start right after it.
  const dictate = async (mode = "transcript") => {
    hotkey.emit("record-start");
    advance(3000);
    hotkey.emit("record-stop", { mode });
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

  it("saves the audio of the dictation and keeps its name and the texts in the history entry", async () => {
    const saved = [];
    const h = harness({ deps: { recordings: { save: (bytes, at) => (saved.push([bytes.length, at]), "rec-1") } } });
    await h.dictate();
    h.mistral.resolve("primary text");
    await flush();

    expect(saved).toEqual([[44 + 3 * 16000 * 2, 3000]]);
    const [entry] = h.history.list();
    expect(entry.recording).toBe("rec-1");
    expect(entry.text).toBe("primary text");
    expect(entry.models[0].text).toBe("primary text");
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
      { label: "Google", ms: 1000, status: "ok", typed: true, text: "secondary text" },
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

describe("Controller merge model", () => {
  // Google answers first unless a test says otherwise. The merge model is a
  // Google chat model; each call is recorded and answered by `answer`.
  function mergeHarness({ config = {}, answer = async () => "merged text", dictionary } = {}) {
    const calls = [];
    // The answer streams in word by word, as the real chat clients do it.
    const chat = async (text, opts) => {
      calls.push({ text, opts });
      const result = await answer(text, opts);
      if (opts.onDelta) for (const piece of result.split(/(?<= )/)) opts.onDelta(piece);
      return result.trim();
    };
    const deps = { googleSummarize: chat, summarize: chat };
    if (dictionary) deps.dictionary = { load: async () => dictionary, current: () => dictionary };
    const h = harness({ config: { primaryModel: "", mergeModel: "google/gemini-flash-lite", ...config }, deps });
    return { ...h, calls };
  }

  it("merges the texts of both models and types the merged text", async () => {
    const h = mergeHarness();
    await h.dictate();
    h.advance(1000);
    h.google.resolve("google text");
    await flush();
    h.advance(400);
    h.mistral.resolve("mistral text");
    await flush();

    expect(h.typed.join("")).toBe("merged text");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].opts).toMatchObject({
      apiKey: "google-key",
      model: "gemini-flash-lite",
      prompt: expect.stringMatching(/Remove filler words/),
      timeoutMs: 5000,
    });
    expect(h.calls[0].text).toContain('<transcript model="Google">\ngoogle text\n</transcript>');
    expect(h.calls[0].text).toContain('<transcript model="Mistral">\nmistral text\n</transcript>');
    const entry = h.history.list()[0];
    expect(entry.mergeWaitMs).toBe(400);
    expect(entry.mergeMs).toBe(0);
    expect(entry.models.map((m) => m.typed)).toEqual([true, true]);
    expect(h.controller.lastTranscripts.map((t) => t.label)).toEqual(["Google", "Mistral", "Merged"]);
  });

  it("starts the clock with the first answer that is not the live Microsoft text", async () => {
    const h = mergeHarness({
      config: { transcriptionModels: ["google", "microsoft"], microsoftEndpoint: "https://res.services.ai.azure.com" },
    });
    await h.dictate();
    h.advance(300);
    h.sessions[0].complete("live text");
    await flush();
    expect(h.waits).toEqual([]);

    h.advance(700);
    h.google.resolve("google text");
    await flush();
    expect(h.waits.map((w) => w.ms)).toEqual([1000]);

    h.waits[0].end();
    await flush();
    expect(h.calls[0].text).toContain('<transcript model="Microsoft (live)">\nlive text\n</transcript>');
    expect(h.typed.join("")).toBe("merged text");
  });

  it("uses a Mistral merge model with the Mistral key", async () => {
    const h = mergeHarness({ config: { mergeModel: "mistral/mistral-small-latest" } });
    await h.dictate();
    h.google.resolve("google text");
    h.mistral.resolve("mistral text");
    await flush();

    expect(h.calls[0].opts).toMatchObject({ apiKey: "key", model: "mistral-small-latest" });
    expect(h.typed.join("")).toBe("merged text");
  });

  it("stops typing when the merge answer gets much longer than every transcript", async () => {
    const h = mergeHarness({ answer: async () => "Sure! Here is a long answer to your question. ".repeat(5) });
    await h.dictate();
    h.google.resolve("google text");
    await flush();
    h.mistral.resolve("mistral text");
    await flush();

    // The limit is 2 × 12 + 20 = 44 characters.
    expect(h.typed.join("")).toBe("Sure! Here is a long answer to your");
    expect(h.notifications).toEqual(["The merge model wrote too much — typing stopped"]);
    expect(h.history.list()[0].mergeFailed).toBe(true);
  });

  it("types the merged text while it streams in", async () => {
    let finish;
    const h = mergeHarness({
      answer: async (_text, opts) => {
        opts.onDelta("Hello ");
        opts.onDelta("big ");
        await new Promise((r) => (finish = r));
        return "world";
      },
    });
    await h.dictate();
    h.google.resolve("google text");
    h.mistral.resolve("mistral text");
    await flush();

    // The space at the end waits for the next piece.
    expect(h.typed.join("")).toBe("Hello big");
    finish();
    await flush();
    expect(h.typed.join("")).toBe("Hello big world");
  });

  it("keeps the typed text and says so when the stream breaks off", async () => {
    const h = mergeHarness({
      answer: async (_text, opts) => {
        opts.onDelta("Hello big ");
        throw new Error("connection reset");
      },
    });
    await h.dictate();
    h.google.resolve("google text");
    h.mistral.resolve("mistral text");
    await flush();

    expect(h.typed.join("")).toBe("Hello big");
    expect(h.notifications).toEqual(["Merge stopped — the text may be incomplete"]);
  });

  it("summarises the merged text and types the summary after it", async () => {
    const h = mergeHarness({ answer: async (text) => (text.startsWith("<") ? "merged text" : "short summary") });
    await h.dictate("summary");
    h.google.resolve("google text");
    h.mistral.resolve("mistral text");
    await flush();

    expect(h.calls.map((c) => c.text).at(-1)).toBe("merged text");
    expect(h.typed.join("")).toMatch(/^merged text.+short summary$/s);
  });

  it("does not merge when the other model hears nothing", async () => {
    const h = mergeHarness();
    await h.dictate();
    h.google.resolve("google text");
    h.mistral.resolve("");
    await flush();

    expect(h.typed).toEqual(["google text"]);
    expect(h.calls).toEqual([]);
  });

  it("waits for the other model until 2 times the answer time of the first one", async () => {
    const h = mergeHarness();
    await h.dictate();
    h.advance(1000);
    h.google.resolve("google text");
    await flush();

    expect(h.typed).toEqual([]);
    expect(h.waits.map((w) => w.ms)).toEqual([1000]);
  });

  it("types the first text without a merge when the other model is too late", async () => {
    const h = mergeHarness();
    await h.dictate();
    h.advance(1000);
    h.google.resolve("google text");
    await flush();
    h.advance(1000);
    h.waits[0].end();
    await flush();
    h.mistral.resolve("late text");
    await flush();

    expect(h.typed).toEqual(["google text"]);
    expect(h.calls).toEqual([]);
  });

  it("types the one text without a merge when the other model fails", async () => {
    const h = mergeHarness();
    await h.dictate();
    h.mistral.reject(new TranscriberError("TIMEOUT", "timed out"));
    h.google.resolve("google text");
    await flush();

    expect(h.typed).toEqual(["google text"]);
    expect(h.calls).toEqual([]);
    expect(h.notifications).toEqual([]);
  });

  it("types the primary text and says so when the merge fails", async () => {
    const h = mergeHarness({
      config: { primaryModel: "mistral" },
      answer: async () => {
        throw new Error("chat down");
      },
    });
    await h.dictate();
    h.google.resolve("google text");
    await flush();
    h.mistral.resolve("mistral text");
    await flush();

    expect(h.typed).toEqual(["mistral text"]);
    expect(h.notifications).toEqual(["Merge failed — typed one transcript"]);
    expect(h.history.list()[0].mergeFailed).toBe(true);
  });

  it("gives the dictionary terms to the merge model and corrects its answer", async () => {
    const h = mergeHarness({
      dictionary: parseDictionary("VoiceTyper\nchax\n"),
      answer: async () => "I use voicetyper at Chax",
    });
    await h.dictate();
    h.google.resolve("google text");
    h.mistral.resolve("mistral text");
    await flush();

    expect(h.calls[0].text).toMatch(/^<dictionary>\nVoiceTyper\nchax\n<\/dictionary>\n\n<transcript model="Google">/);
    expect(h.typed.join("")).toBe("I use VoiceTyper at chax");
  });

  it("does not merge with only one checked model", async () => {
    const h = mergeHarness({ config: { transcriptionModels: ["mistral"] } });
    await h.dictate();
    h.mistral.resolve("mistral text");
    await flush();

    expect(h.typed).toEqual(["mistral text"]);
    expect(h.calls).toEqual([]);
    expect(h.history.list()[0].mergeWaitMs).toBeNull();
  });

  it("reports the error when every model fails", async () => {
    const h = mergeHarness();
    await h.dictate();
    h.mistral.reject(new TranscriberError("TIMEOUT", "timed out"));
    h.google.reject(new TranscriberError("TIMEOUT", "timed out"));
    await flush();

    expect(h.typed).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(h.notifications).toEqual(["Mistral transcription timed out"]);
  });
});
