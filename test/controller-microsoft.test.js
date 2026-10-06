import { describe, it, expect } from "vitest";
import EventEmitter from "events";
import { Controller } from "../src/main/controller.js";
import { MicrosoftError } from "../src/shared/microsoft.js";
import { TyperError } from "../src/main/typer.js";

function wavOfMs(ms, sampleRate = 16000) {
  const samples = Math.round((ms / 1000) * sampleRate);
  return new Uint8Array(44 + samples * 2);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// A Microsoft session the test drives by hand: it decides when deltas arrive
// and when finish() settles.
function fakeSession(opts) {
  let resolveFinish;
  let rejectFinish;
  const finished = new Promise((res, rej) => {
    resolveFinish = res;
    rejectFinish = rej;
  });
  finished.catch(() => {});
  return {
    opts,
    appended: [],
    cancelled: false,
    finishCalls: 0,
    append(bytes) {
      this.appended.push(bytes);
    },
    finish() {
      this.finishCalls++;
      return finished;
    },
    cancel() {
      this.cancelled = true;
      resolveFinish("");
    },
    delta(text) {
      opts.onDelta(text);
    },
    complete: (text) => resolveFinish(text),
    fail: (err) => rejectFinish(err),
  };
}

function harness(overrides = {}) {
  const hotkey = new EventEmitter();
  let wavCb = () => {};
  let chunkCb = () => {};
  const recorder = {
    starts: [],
    stopped: 0,
    start(opts) {
      this.starts.push(opts);
    },
    stop() {
      this.stopped++;
    },
    onWav(cb) {
      wavCb = cb;
    },
    onChunk(cb) {
      chunkCb = cb;
    },
  };
  const typed = [];
  const states = [];
  const notifications = [];
  const sessions = [];
  const batchCalls = [];
  const clipboard = [];
  let nowMs = 0;
  const config = {
    model: "voxtral-mini-latest",
    language: "de",
    summaryModel: "mistral-small-latest",
    summaryPrompt: "Be terse.",
    separator: "blank-line",
    transcriptionModels: ["microsoft"],
    microsoftEndpoint: "https://res.services.ai.azure.com",
    microsoftDeployment: "MAI-Transcribe-2-Streaming",
    ...overrides.config,
  };
  const deps = {
    hotkey,
    recorder,
    transcribe: overrides.transcribe || (async () => "mistral-text"),
    summarize: overrides.summarize || (async () => "summary"),
    typer: overrides.typer || {
      type: async (t) => typed.push(t),
      typeParts: async (parts, separator) => typed.push({ parts, separator }),
    },
    tray: { setState: (s) => states.push(s) },
    getApiKey: () => "key",
    getGoogleApiKey: () => "google-key",
    getMicrosoftApiKey: overrides.getMicrosoftApiKey || (() => "ms-key"),
    googleTranscribe: overrides.googleTranscribe || (async () => "google-text"),
    googleSummarize: async () => "google-summary",
    microsoftTranscribe: async (bytes, opts) => {
      batchCalls.push(opts);
      return overrides.microsoftTranscribe ? overrides.microsoftTranscribe(bytes, opts) : new Promise(() => {});
    },
    openMicrosoftStream:
      overrides.openMicrosoftStream ||
      ((opts) => {
        const s = fakeSession(opts);
        sessions.push(s);
        return s;
      }),
    copyToClipboard: (t) => clipboard.push(t),
    getConfig: () => config,
    notify: (t, b) => notifications.push(b),
    minDurationMs: 200,
    minHoldMs: 1000,
    now: () => nowMs,
    sampleRate: 16000,
  };
  const controller = new Controller(deps);
  controller.start();
  return {
    controller,
    hotkey,
    recorder,
    sessions,
    batchCalls,
    typed,
    states,
    notifications,
    clipboard,
    config,
    fireWav: (bytes, id) => wavCb(bytes, id),
    fireChunk: (bytes, id) => chunkCb(bytes, id),
    lastId: () => recorder.starts.at(-1).id,
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

describe("Controller with the Microsoft provider", () => {
  it("opens a session at key-down with the configured settings and asks for streamed audio", () => {
    const h = harness();
    h.hotkey.emit("record-start");
    expect(h.sessions).toHaveLength(1);
    expect(h.sessions[0].opts).toMatchObject({
      apiKey: "ms-key",
      endpoint: "https://res.services.ai.azure.com",
      deployment: "MAI-Transcribe-2-Streaming",
      language: "de",
    });
    expect(h.recorder.starts[0]).toMatchObject({ stream: true });
  });

  it("appends streamed chunks to the session of the same capture", () => {
    const h = harness();
    h.hotkey.emit("record-start");
    const chunk = new Uint8Array([1, 2]);
    h.fireChunk(chunk, h.lastId());
    h.fireChunk(new Uint8Array([9]), 999);
    expect(h.sessions[0].appended).toEqual([chunk]);
  });

  it("types finalised text live once the hold is long enough", async () => {
    const h = harness();
    h.hotkey.emit("record-start");
    h.advance(1200);
    h.sessions[0].delta("Hallo");
    await flush();
    expect(h.typed).toEqual(["Hallo"]);
    h.sessions[0].delta(" Welt");
    await flush();
    expect(h.typed).toEqual(["Hallo", " Welt"]);
  });

  it("holds back text that arrives before the minimum hold, then types it", async () => {
    const h = harness();
    h.hotkey.emit("record-start");
    h.advance(500);
    h.sessions[0].delta("early ");
    await flush();
    expect(h.typed).toEqual([]);
    h.advance(700);
    h.sessions[0].delta("late");
    await flush();
    expect(h.typed).toEqual(["early late"]);
  });

  it("finishes the session when the WAV arrives and types text confirmed after release", async () => {
    const h = harness();
    h.hotkey.emit("record-start");
    const id = h.lastId();
    h.advance(1200);
    h.sessions[0].delta("one");
    h.hotkey.emit("record-stop");
    h.fireWav(wavOfMs(1200), id);
    await flush();
    expect(h.sessions[0].finishCalls).toBe(1);
    h.sessions[0].delta(" two");
    h.sessions[0].complete("one two");
    await flush();
    expect(h.typed).toEqual(["one", " two"]);
    expect(h.states.at(-1)).toBe("active");
  });

  it("types the final transcript if no delta ever arrived", async () => {
    const h = harness();
    h.hotkey.emit("record-start");
    const id = h.lastId();
    h.advance(1200);
    h.hotkey.emit("record-stop");
    h.fireWav(wavOfMs(1200), id);
    h.sessions[0].complete("only final");
    await flush();
    expect(h.typed).toEqual(["only final"]);
  });

  it("cancels the session and types nothing for a short tap", async () => {
    const h = harness();
    h.hotkey.emit("record-start");
    const id = h.lastId();
    h.advance(300);
    h.sessions[0].delta("oops");
    h.hotkey.emit("record-stop");
    h.fireWav(wavOfMs(300), id);
    await flush();
    expect(h.sessions[0].cancelled).toBe(true);
    expect(h.typed).toEqual([]);
  });

  it("types the summary after the live transcript in summary mode", async () => {
    let summarized = null;
    const h = harness({
      summarize: async (text) => {
        summarized = text;
        return "short";
      },
    });
    h.hotkey.emit("record-start");
    const id = h.lastId();
    h.advance(1200);
    h.sessions[0].delta("long text");
    h.hotkey.emit("record-stop", { mode: "summary" });
    h.fireWav(wavOfMs(1200), id);
    h.sessions[0].complete("long text");
    await flush();
    await flush();
    expect(summarized).toBe("long text");
    expect(h.typed).toEqual(["long text", "\n\nshort"]);
  });

  it("notifies and keeps the typed text when the session fails", async () => {
    const h = harness();
    h.hotkey.emit("record-start");
    const id = h.lastId();
    h.advance(1200);
    h.sessions[0].delta("partial");
    h.hotkey.emit("record-stop");
    h.fireWav(wavOfMs(1200), id);
    h.sessions[0].fail(new MicrosoftError("UNAUTHORIZED", "bad"));
    await flush();
    await flush();
    expect(h.typed).toEqual(["partial"]);
    expect(h.notifications).toContain("Invalid Microsoft API key");
    expect(h.states).toContain("error");
  });

  it("does not start recording when the session cannot be opened", () => {
    const h = harness({
      openMicrosoftStream: () => {
        throw new MicrosoftError("NO_ENDPOINT", "no endpoint");
      },
    });
    h.hotkey.emit("record-start");
    expect(h.recorder.starts).toEqual([]);
    expect(h.notifications).toEqual(["Set your Microsoft endpoint in Settings"]);
    expect(h.states.at(-1)).toBe("error");
  });

  it("asks for the Microsoft key or endpoint when either is missing", () => {
    const noKey = harness({ getMicrosoftApiKey: () => null });
    noKey.hotkey.emit("record-start");
    expect(noKey.notifications).toEqual(["Set your Microsoft API key in Settings"]);
    expect(noKey.sessions).toEqual([]);

    const noEndpoint = harness({ config: { microsoftEndpoint: "" } });
    expect(noEndpoint.states.at(-1)).toBe("error");
    noEndpoint.hotkey.emit("record-start");
    expect(noEndpoint.notifications).toEqual(["Set your Microsoft endpoint in Settings"]);
  });

  it("keeps the text of a quick second dictation after the first one", async () => {
    const h = harness();
    h.hotkey.emit("record-start");
    const first = h.lastId();
    h.advance(1200);
    h.sessions[0].delta("first");
    h.hotkey.emit("record-stop");
    // The next hold starts before the first WAV arrives.
    h.hotkey.emit("record-start");
    const second = h.lastId();
    expect(h.sessions[0].cancelled).toBe(false);
    h.fireWav(wavOfMs(1200), first);
    h.advance(1200);
    h.sessions[1].delta("second");
    await flush();
    // The first dictation is still open (no final transcript yet), so the
    // second one waits instead of interleaving.
    expect(h.typed).toEqual(["first"]);
    h.sessions[0].complete("first");
    await flush();
    await flush();
    expect(h.typed).toEqual(["first", "second"]);
    h.hotkey.emit("record-stop");
    h.fireWav(wavOfMs(1200), second);
    h.sessions[1].complete("second");
    await flush();
    expect(h.typed).toEqual(["first", "second"]);
  });

  it("drops a session whose WAV never arrived when the next hold starts much later", () => {
    const h = harness();
    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop");
    h.advance(10000);
    h.hotkey.emit("record-start");
    expect(h.sessions[0].cancelled).toBe(true);
    expect(h.sessions[1].cancelled).toBe(false);
  });

  it("drops a lost session on a later hold even when Microsoft is no longer checked", async () => {
    const h = harness();
    h.hotkey.emit("record-start");
    h.advance(1200);
    // The WAV of this hold never arrives.
    h.hotkey.emit("record-stop");
    h.advance(100);
    h.hotkey.emit("record-start");
    const second = h.lastId();
    h.advance(1200);
    h.sessions[1].delta("second");
    h.hotkey.emit("record-stop");
    h.fireWav(wavOfMs(1200), second);
    h.sessions[1].complete("second");
    await flush();
    expect(h.typed).toEqual([]);
    h.config.transcriptionModels = ["mistral"];
    h.advance(10000);
    h.hotkey.emit("record-start");
    await flush();
    await flush();
    expect(h.sessions[0].cancelled).toBe(true);
    expect(h.typed).toEqual(["second"]);
  });

  it("shows the recording state while a previous dictation finishes", async () => {
    const h = harness();
    h.hotkey.emit("record-start");
    const id = h.lastId();
    h.advance(1200);
    h.hotkey.emit("record-stop");
    h.fireWav(wavOfMs(1200), id);
    h.hotkey.emit("record-start");
    h.sessions[0].complete("done");
    await flush();
    expect(h.states.at(-1)).toBe("recording");
  });
});

describe("Controller with Microsoft and other models", () => {
  const all = ["mistral", "google", "microsoft"];

  it("does not type live and types the session transcript when it is first", async () => {
    const h = harness({
      config: { transcriptionModels: all },
      transcribe: () => new Promise(() => {}),
      googleTranscribe: () => new Promise(() => {}),
    });
    h.hotkey.emit("record-start");
    const id = h.lastId();
    h.advance(1200);
    h.sessions[0].delta("ms text");
    await flush();
    expect(h.typed).toEqual([]);
    h.hotkey.emit("record-stop");
    h.fireWav(wavOfMs(1200), id);
    h.sessions[0].complete("ms text");
    await flush();
    expect(h.typed).toEqual(["ms text"]);
  });

  it("also asks the non-streaming Microsoft model and types its transcript when it is first", async () => {
    const h = harness({
      config: { transcriptionModels: ["mistral", "microsoft"] },
      transcribe: () => new Promise(() => {}),
      microsoftTranscribe: async () => "batch text",
    });
    h.hotkey.emit("record-start");
    const id = h.lastId();
    h.advance(1200);
    h.hotkey.emit("record-stop");
    h.fireWav(wavOfMs(1200), id);
    await flush();
    expect(h.batchCalls).toEqual([
      { apiKey: "ms-key", endpoint: "https://res.services.ai.azure.com", language: "de" },
    ]);
    expect(h.typed).toEqual(["batch text"]);
    h.sessions[0].complete("late session text");
    await flush();
    expect(h.typed).toEqual(["batch text"]);
  });

  it("does not ask the non-streaming model when Microsoft alone types live", async () => {
    const h = harness();
    h.hotkey.emit("record-start");
    const id = h.lastId();
    h.advance(1200);
    h.hotkey.emit("record-stop");
    h.fireWav(wavOfMs(1200), id);
    h.sessions[0].complete("live");
    await flush();
    expect(h.batchCalls).toEqual([]);
  });

  it("needs the credentials of every checked model", () => {
    const h = harness({ config: { transcriptionModels: all }, getMicrosoftApiKey: () => "" });
    h.hotkey.emit("record-start");
    expect(h.notifications).toEqual(["Set your Microsoft API key in Settings"]);
  });
});

describe("Controller clipboard fallback", () => {
  it("puts the untyped rest on the clipboard when a modifier stays down", async () => {
    const h = harness({
      config: { transcriptionModels: ["mistral"] },
      typer: {
        type: async () => {
          throw new TyperError("MODIFIER_HELD", "held", "rest of text");
        },
        typeParts: async () => {},
      },
    });
    h.hotkey.emit("record-start");
    const id = h.lastId();
    h.advance(1200);
    h.hotkey.emit("record-stop");
    h.fireWav(wavOfMs(1200), id);
    await flush();
    expect(h.clipboard).toEqual(["rest of text"]);
    expect(h.notifications).toEqual(["A modifier key was held — the rest of the text is on the clipboard"]);
  });

  it("collects the rest of a live dictation on the clipboard", async () => {
    let calls = 0;
    const h = harness({
      typer: {
        type: async (t) => {
          calls++;
          if (calls === 2) throw new TyperError("MODIFIER_HELD", "held", t.slice(1));
        },
        typeParts: async () => {},
      },
    });
    h.hotkey.emit("record-start");
    const id = h.lastId();
    h.advance(1200);
    h.sessions[0].delta("ok ");
    h.sessions[0].delta("blocked");
    h.sessions[0].delta(" more");
    h.hotkey.emit("record-stop");
    h.fireWav(wavOfMs(1200), id);
    h.sessions[0].complete("ok blocked more");
    await flush();
    await flush();
    expect(h.clipboard).toEqual(["locked more"]);
  });
});
