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
    summarize: overrides.summarize || (async () => "summary"),
    typer: overrides.typer || {
      type: async (t) => typed.push(t),
      typeParts: async (parts, separator) => typed.push({ parts, separator }),
    },
    tray: { setState: (s) => states.push(s) },
    getApiKey: overrides.getApiKey || (() => "key"),
    getGoogleApiKey: overrides.getGoogleApiKey || (() => "google-key"),
    googleTranscribe: overrides.googleTranscribe || (async () => "google-text"),
    googleSummarize: overrides.googleSummarize || (async () => "google-summary"),
    getConfig:
      overrides.getConfig ||
      (() => ({
        model: "voxtral-mini-latest",
        language: "auto",
        summaryModel: "mistral-small-latest",
        summaryPrompt: "Be terse.",
        separator: "blank-line",
      })),
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
      summarize: async () => "summary",
      typer: { type: async (t) => typed.push(t), typeParts: async () => {} },
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

  it("types transcript then summary when the stop reports summary mode", async () => {
    let captured;
    const summarize = async (text, opts) => {
      captured = { text, opts };
      return "the summary";
    };
    const h = harness({ summarize });
    h.controller.start();
    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop", { mode: "summary" });
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));

    expect(h.typed).toEqual([{ parts: ["text", "the summary"], separator: "blank-line" }]);
    expect(captured.text).toBe("text");
    expect(captured.opts.model).toBe("mistral-small-latest");
    expect(captured.opts.prompt).toBe("Be terse.");
    expect(captured.opts.apiKey).toBe("key");
    expect(h.states[h.states.length - 1]).toBe("active");
  });

  it("passes the configured separator through to the typer", async () => {
    const h = harness({
      getConfig: () => ({
        model: "m",
        language: "auto",
        summaryModel: "sm",
        summaryPrompt: "p",
        separator: "dash",
      }),
    });
    h.controller.start();
    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop", { mode: "summary" });
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));

    expect(h.typed).toEqual([{ parts: ["text", "summary"], separator: "dash" }]);
  });

  it("types the transcript alone and notifies when summarization fails", async () => {
    const h = harness({
      summarize: async () => {
        throw new Error("chat api down");
      },
    });
    h.controller.start();
    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop", { mode: "summary" });
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));

    expect(h.typed).toEqual(["text"]);
    expect(h.notifications).toEqual([["VoiceTyper", "Summary failed — typed transcript only"]]);
    expect(h.states).not.toContain("error");
    expect(h.states[h.states.length - 1]).toBe("active");
  });

  it("does not call summarize in transcript mode", async () => {
    let called = 0;
    const h = harness({
      summarize: async () => {
        called++;
        return "s";
      },
    });
    h.controller.start();
    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop", { mode: "transcript" });
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));

    expect(called).toBe(0);
    expect(h.typed).toEqual(["text"]);
  });

  it("treats an absent record-stop payload as transcript mode", async () => {
    const h = harness();
    h.controller.start();
    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop");
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.typed).toEqual(["text"]);
  });

  it("keeps each recording's own mode across back-to-back holds", async () => {
    const h = harness();
    h.controller.start();

    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop", { mode: "summary" });
    h.fireWav(wavOfMs(1000));

    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop", { mode: "transcript" });
    h.fireWav(wavOfMs(1000));

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(h.typed).toEqual([
      { parts: ["text", "summary"], separator: "blank-line" },
      "text",
    ]);
  });

  it("does not summarize when the transcript came back empty", async () => {
    let called = 0;
    const h = harness({
      transcribe: async () => "",
      summarize: async () => {
        called++;
        return "s";
      },
    });
    h.controller.start();
    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop", { mode: "summary" });
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));

    expect(called).toBe(0);
    expect(h.typed).toEqual([]);
    expect(h.notifications).toEqual([]);
  });

  it("reports a typing failure as 'Typing failed', not transcription failure, and does not redden the tray", async () => {
    const typeErr = new Error("keyboard busy");
    const h = harness({
      typer: {
        type: async () => {
          throw typeErr;
        },
        typeParts: async () => {
          throw typeErr;
        },
      },
    });
    h.controller.start();
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));

    expect(h.notifications).toEqual([["VoiceTyper", "Typing failed"]]);
    expect(h.states).not.toContain("error");
    expect(h.states[h.states.length - 1]).toBe("active");
  });

  it("reports a typing failure in summary mode the same way", async () => {
    const h = harness({
      typer: {
        type: async () => {},
        typeParts: async () => {
          throw new Error("keyboard busy");
        },
      },
    });
    h.controller.start();
    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop", { mode: "summary" });
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));

    expect(h.notifications).toEqual([["VoiceTyper", "Typing failed"]]);
    expect(h.states).not.toContain("error");
  });

  it("caps the summary call's timeout and disables its retries so the transcript is not delayed", async () => {
    let captured;
    const summarize = async (text, opts) => {
      captured = opts;
      return "the summary";
    };
    const h = harness({ summarize });
    h.controller.start();
    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop", { mode: "summary" });
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));

    expect(captured.timeoutMs).toBe(10000);
    expect(captured.maxAttempts).toBe(1);
  });

  // Regression test for the modeQueue desync (commit cf60107): if
  // getUserMedia rejects (mic denied/busy/unplugged), the renderer never
  // sends capture:pcm, so no WAV ever arrives for a stopped recording. A FIFO
  // modeQueue would leave that entry permanently at the front, mislabeling
  // every later clip for the rest of the process's life. The single
  // pendingMode field instead leaves one stale value that the very next
  // record-stop overwrites — a lost WAV, not a permanent desync.
  it("does not let a lost WAV (no capture:pcm after a stop) mislabel the next recording", async () => {
    const h = harness();
    h.controller.start();

    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop", { mode: "summary" });
    // No fireWav here: simulates getUserMedia rejecting, so this clip's WAV
    // is lost entirely.

    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop", { mode: "transcript" });
    h.fireWav(wavOfMs(1000));

    await new Promise((r) => setTimeout(r, 0));

    expect(h.typed).toEqual(["text"]);
  });

  it("dispatches to googleTranscribe when provider is google", async () => {
    let googleCalled = false;
    const h = harness({
      getConfig: () => ({
        model: "voxtral-mini-latest",
        language: "auto",
        summaryModel: "mistral-small-latest",
        summaryPrompt: "Be terse.",
        separator: "blank-line",
        transcriptionProvider: "google",
      }),
      googleTranscribe: async () => {
        googleCalled = true;
        return "google text";
      },
      transcribe: async () => {
        throw new Error("should not call mistral");
      },
    });
    h.controller.start();
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));
    expect(googleCalled).toBe(true);
    expect(h.typed).toEqual(["google text"]);
  });

  it("dispatches to both providers in both mode and types both results with labels", async () => {
    const h = harness({
      getConfig: () => ({
        model: "voxtral-mini-latest",
        language: "auto",
        summaryModel: "mistral-small-latest",
        summaryPrompt: "Be terse.",
        separator: "blank-line",
        transcriptionProvider: "both",
      }),
      transcribe: async () => "mistral text",
      googleTranscribe: async () => "google text",
    });
    h.controller.start();
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.typed).toEqual([{
      parts: ["[Mistral]\nmistral text", "[Google]\ngoogle text"],
      separator: "blank-line",
    }]);
  });

  it("types the surviving result and notifies when one provider fails in both mode", async () => {
    const h = harness({
      getConfig: () => ({
        model: "voxtral-mini-latest",
        language: "auto",
        summaryModel: "mistral-small-latest",
        summaryPrompt: "Be terse.",
        separator: "blank-line",
        transcriptionProvider: "both",
      }),
      transcribe: async () => {
        throw new Error("mistral down");
      },
      googleTranscribe: async () => "google text",
    });
    h.controller.start();
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.typed).toEqual(["[Google]\ngoogle text"]);
    expect(h.notifications.some((n) => n[1].includes("Mistral"))).toBe(true);
  });

  it("shows error when both providers fail in both mode", async () => {
    const h = harness({
      getConfig: () => ({
        model: "voxtral-mini-latest",
        language: "auto",
        summaryModel: "mistral-small-latest",
        summaryPrompt: "Be terse.",
        separator: "blank-line",
        transcriptionProvider: "both",
      }),
      transcribe: async () => {
        throw new TranscriberError("UNAUTHORIZED", "bad key");
      },
      googleTranscribe: async () => {
        throw new Error("google down");
      },
    });
    h.controller.start();
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.typed).toEqual([]);
    expect(h.states).toContain("error");
    expect(h.notifications.length).toBeGreaterThan(0);
  });

  it("dispatches summary to googleSummarize when summaryModel has google/ prefix", async () => {
    let googleSummarizeCalled = false;
    let capturedModel;
    const h = harness({
      getConfig: () => ({
        model: "voxtral-mini-latest",
        language: "auto",
        summaryModel: "google/gemini-3.7-flash",
        summaryPrompt: "Be terse.",
        separator: "blank-line",
        transcriptionProvider: "mistral",
      }),
      googleSummarize: async (text, opts) => {
        googleSummarizeCalled = true;
        capturedModel = opts.model;
        return "google summary";
      },
      summarize: async () => {
        throw new Error("should not call mistral summarize");
      },
    });
    h.controller.start();
    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop", { mode: "summary" });
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));
    expect(googleSummarizeCalled).toBe(true);
    expect(capturedModel).toBe("gemini-3.7-flash");
    expect(h.typed).toEqual([{ parts: ["text", "google summary"], separator: "blank-line" }]);
  });

  it("dispatches summary to mistral when summaryModel has mistral/ prefix", async () => {
    let capturedModel;
    const h = harness({
      getConfig: () => ({
        model: "voxtral-mini-latest",
        language: "auto",
        summaryModel: "mistral/mistral-large-latest",
        summaryPrompt: "Be terse.",
        separator: "blank-line",
        transcriptionProvider: "mistral",
      }),
      summarize: async (text, opts) => {
        capturedModel = opts.model;
        return "mistral summary";
      },
    });
    h.controller.start();
    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop", { mode: "summary" });
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));
    expect(capturedModel).toBe("mistral-large-latest");
  });

  it("dispatches summary to mistral when summaryModel has no prefix", async () => {
    let mistralCalled = false;
    const h = harness({
      getConfig: () => ({
        model: "voxtral-mini-latest",
        language: "auto",
        summaryModel: "mistral-small-latest",
        summaryPrompt: "Be terse.",
        separator: "blank-line",
        transcriptionProvider: "mistral",
      }),
      summarize: async () => {
        mistralCalled = true;
        return "s";
      },
    });
    h.controller.start();
    h.hotkey.emit("record-start");
    h.advance(1200);
    h.hotkey.emit("record-stop", { mode: "summary" });
    h.fireWav(wavOfMs(1000));
    await new Promise((r) => setTimeout(r, 0));
    expect(mistralCalled).toBe(true);
  });
});
