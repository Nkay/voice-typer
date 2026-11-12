const { createTypingLanes } = require("./typingLanes.js");
const { separatorText } = require("./typer.js");

const PROVIDER_LABELS = { MicrosoftError: "Microsoft", GoogleError: "Google" };

// Taps this short, each this soon after the one before, count as one gesture:
// two copy the last transcripts, three start a recording that continues after
// the release. A tap is known only at its release, so a longer press still
// records as usual.
const TAP_MS = 400;

// When another model answers before the primary model, the primary gets until
// this many times the answer time of that model. Then the other text is typed.
const PRIMARY_PATIENCE = 1.5;

class Controller {
  constructor(deps) {
    this.hotkey = deps.hotkey;
    this.recorder = deps.recorder;
    this.transcribe = deps.transcribe;
    this.summarize = deps.summarize;
    this.typer = deps.typer;
    this.tray = deps.tray;
    this.getApiKey = deps.getApiKey;
    this.getGoogleApiKey = deps.getGoogleApiKey;
    this.googleTranscribe = deps.googleTranscribe;
    this.googleSummarize = deps.googleSummarize;
    this.getMicrosoftApiKey = deps.getMicrosoftApiKey || (() => null);
    this.openMicrosoftStream = deps.openMicrosoftStream;
    this.microsoftTranscribe = deps.microsoftTranscribe;
    this.copyToClipboard = deps.copyToClipboard || null;
    // Where the duration of each step of a dictation is recorded.
    this.history = deps.history || { add() {}, update() {} };
    this.getConfig = deps.getConfig;
    this.notify = deps.notify;
    this.minDurationMs = deps.minDurationMs != null ? deps.minDurationMs : 200;
    this.minHoldMs = deps.minHoldMs != null ? deps.minHoldMs : 1000;
    this.now = deps.now || Date.now;
    this.wait = deps.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.sampleRate = deps.sampleRate || 16000;

    this.paused = false;
    this.recording = false;
    this.working = false;
    this.queue = [];
    this.pressedAt = 0;
    this.lastHoldMs = Infinity;
    this.releasedAt = -Infinity;
    // Short taps in a row so far.
    this.taps = 0;
    // True while a recording started by a triple tap runs with the key up.
    this.latched = false;
    // The copy of a double press waits for a possible third tap: `pendingCopy`
    // identifies the running wait, `heldCopy` is a copy whose wait a new press
    // interrupted.
    this.pendingCopy = null;
    this.heldCopy = false;
    // How each capture ended, by capture id, from the release until its WAV
    // arrives. A new press can come before that WAV.
    this.stops = new Map();
    // Every transcript of the last dictation, in arrival order, for the double
    // press. A race keeps adding the slower answers after the first is typed.
    this.lastTranscripts = [];
    this.pendingMode = "transcript";
    // Microsoft sessions by capture id, from key-down until the WAV of that
    // capture arrives. Audio chunks carry the same id.
    this.streams = new Map();
    this.captureSeq = 0;
    this.currentCaptureId = null;
    this.lanes = createTypingLanes({
      type: (text) => this.typer.type(text),
      onDiverted: (text) => this._divertToClipboard(text),
      onError: (err) => {
        console.error("VoiceTyper: typing failed", err);
        this.notify("VoiceTyper", "Typing failed");
      },
    });
  }

  start() {
    this.hotkey.on("record-start", () => this._onStart());
    this.hotkey.on("record-stop", (payload) => this._onStop(payload));
    this.recorder.onWav((bytes, captureId) => this._onWav(bytes, captureId));
    if (typeof this.recorder.onChunk === "function") {
      this.recorder.onChunk((bytes, captureId) => {
        const rec = this.streams.get(captureId);
        if (rec) rec.session.append(bytes);
      });
    }
    this._idle();
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    // No key is held during a triple-tap recording, so it would go on while
    // the app shows "paused". It ends like with the stop tap.
    if (this.paused && this.latched) this._onStop();
    this._idle();
  }

  isPaused() {
    return this.paused;
  }

  isRecording() {
    return this.recording;
  }

  refreshKeyState() {
    this._idle();
  }

  // The message for the first credential a selected model needs but lacks, or null.
  _missingCredential(cfg) {
    for (const need of cfg.transcriptionModels || ["mistral"]) {
      if (need === "mistral" && !this.getApiKey()) return "Set your Mistral API key in Settings";
      if (need === "google" && !this.getGoogleApiKey()) return "Set your Google API key in Settings";
      if (need === "microsoft") {
        if (!this.getMicrosoftApiKey()) return "Set your Microsoft API key in Settings";
        if (!cfg.microsoftEndpoint) return "Set your Microsoft endpoint in Settings";
      }
    }
    return null;
  }

  _idle() {
    if (this.paused) return this._setState("paused");
    // A pump that finishes during the next hold must not hide the recording.
    if (this.recording) return this._setState("recording");
    this._setState(this._missingCredential(this.getConfig()) ? "error" : "active");
  }

  _setState(state) {
    this.state = state;
    this.tray.setState(state);
  }

  _onStart() {
    if (this.paused) return;
    const cfg = this.getConfig();
    const missing = this._missingCredential(cfg);
    if (missing) {
      this.notify("VoiceTyper", missing);
      this._setState("error");
      return;
    }
    // Also true for the tap that stops a triple-tap recording.
    if (this.recording) return;
    // Here, not only when Microsoft is checked: a stale live lane blocks every
    // later dictation, whatever the models are now.
    this._dropStaleStreams();

    const models = cfg.transcriptionModels || ["mistral"];
    const streams = models.includes("microsoft");
    const captureId = ++this.captureSeq;
    if (streams && !this._openStream(captureId, models.length === 1, cfg)) return;

    if (this.pendingCopy) {
      this.pendingCopy = null;
      this.heldCopy = true;
    }
    this.recording = true;
    this.currentCaptureId = captureId;
    this.pressedAt = this.now();
    this._setState("recording");
    this.recorder.start(streams ? { stream: true, id: captureId } : { id: captureId });
  }

  // Opens the Microsoft session for this hold. Only Microsoft alone types live;
  // with other models its final transcript joins the race.
  _openStream(captureId, live, cfg) {
    const rec = {
      captureId,
      stoppedAt: null,
      lane: live ? this.lanes.open() : null,
      pending: "",
      typedAny: false,
      qualified: false,
      session: null,
    };
    try {
      rec.session = this.openMicrosoftStream({
        apiKey: this.getMicrosoftApiKey(),
        endpoint: cfg.microsoftEndpoint,
        deployment: cfg.microsoftDeployment,
        language: cfg.language,
        onDelta: (delta) => this._onDelta(rec, delta),
      });
    } catch (err) {
      if (rec.lane) rec.lane.discard();
      this._setState("error");
      this.notify("VoiceTyper", this._errorMessage(err));
      return false;
    }
    this.streams.set(captureId, rec);
    return true;
  }

  // A capture whose WAV never arrives (the microphone failed to open) leaves
  // its session behind. A real WAV follows the release within milliseconds, so
  // a session released this long ago can never finish.
  _dropStaleStreams() {
    for (const [id, rec] of this.streams) {
      if (rec.stoppedAt !== null && this.now() - rec.stoppedAt > 5000) {
        this._discardStream(rec);
        this.streams.delete(id);
      }
    }
  }

  _discardStream(rec) {
    rec.session.cancel();
    if (rec.lane) rec.lane.discard();
  }

  // Finalised text is typed as soon as the hold is long enough to count; text
  // that arrives earlier waits, so a tap that turns out too short types nothing.
  _onDelta(rec, delta) {
    if (!rec.lane) return;
    rec.pending += delta;
    if (!rec.qualified && rec.stoppedAt === null) {
      rec.qualified = this.now() - this.pressedAt >= this.minHoldMs;
    }
    if (rec.qualified) this._flushLive(rec);
  }

  _flushLive(rec) {
    if (!rec.lane || rec.pending.length === 0) return;
    rec.lane.push(rec.pending);
    rec.pending = "";
    rec.typedAny = true;
  }

  _onStop(payload) {
    if (!this.recording) return;
    const now = this.now();
    const heldCopy = this.heldCopy;
    this.heldCopy = false;
    if (this.latched) {
      this.latched = false;
    } else {
      const isTap = now - this.pressedAt < TAP_MS;
      const inRow = this.pressedAt - this.releasedAt < TAP_MS;
      this.taps = !isTap ? 0 : inRow ? this.taps + 1 : 1;
      if (this.taps === 3) {
        // The recording of this tap goes on until the next tap; the copy of
        // the two taps before it is dropped.
        this.taps = 0;
        this.latched = true;
        this.notify("VoiceTyper", "Recording — tap the record key to stop");
        return;
      }
    }
    this.recording = false;
    this.releasedAt = now;
    this.lastHoldMs = now - this.pressedAt;
    this.pendingMode = payload && payload.mode === "summary" ? "summary" : "transcript";
    this.stops.set(this.currentCaptureId, { holdMs: this.lastHoldMs, mode: this.pendingMode, releasedAt: now });
    const rec = this.streams.get(this.currentCaptureId);
    if (rec) rec.stoppedAt = now;
    this.recorder.stop();
    // A press that interrupted the wait of a double press was no third tap.
    if (heldCopy) this._copyTranscripts();
    // A double press; the recordings of both taps are too short to count.
    if (this.taps === 2) this._copyAfterWait();
  }

  // A third tap in time turns the double press into a triple tap, so the copy
  // waits for that long.
  _copyAfterWait() {
    const pending = {};
    this.pendingCopy = pending;
    this.wait(TAP_MS).then(() => {
      if (this.pendingCopy !== pending) return;
      this.pendingCopy = null;
      this._copyTranscripts();
    });
  }

  _onWav(bytes, captureId) {
    const wavAt = this.now();
    // The last release stands in for a WAV whose own release is not known.
    const stop = this.stops.get(captureId) || {
      holdMs: this.lastHoldMs,
      mode: this.pendingMode,
      releasedAt: this.releasedAt,
    };
    this.stops.delete(captureId);
    const rec = this.streams.get(captureId);
    this.streams.delete(captureId);
    const samples = (bytes.length - 44) / 2;
    const durationMs = (samples / this.sampleRate) * 1000;
    if (stop.holdMs < this.minHoldMs || durationMs < this.minDurationMs) {
      if (rec) this._discardStream(rec);
      this._idle();
      return;
    }
    if (rec) {
      rec.qualified = true;
      this._flushLive(rec);
    }
    // A WAV without a release before it has no release time to measure from.
    const releasedAt = Number.isFinite(stop.releasedAt) ? stop.releasedAt : wavAt;
    // One entry of the timing history. `at` is the moment the key came up;
    // every duration is in milliseconds. `models` holds one record per asked
    // model.
    const timing = {
      at: releasedAt,
      live: Boolean(rec && rec.lane),
      recordMs: Math.round(durationMs),
      audioMs: wavAt - releasedAt,
      queueMs: 0,
      models: [],
      primaryWaitMs: null,
      summaryMs: null,
      summaryFailed: false,
      typingMs: null,
      chars: 0,
      totalMs: 0,
    };
    this.queue.push({ bytes, mode: stop.mode, rec, timing });
    this._pump().catch((err) => console.error("VoiceTyper: pump failed", err));
  }

  async _pump() {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length > 0) {
        const { bytes, mode, rec, timing } = this.queue.shift();
        this._setState("processing");
        timing.queueMs = this.now() - (timing.at + timing.audioMs);
        try {
          const cfg = this.getConfig();
          if (rec && rec.lane) await this._finishLive(rec, mode, cfg, timing);
          else await this._race(bytes, mode, cfg, rec, timing);
        } catch (err) {
          this._setState("error");
          this.notify("VoiceTyper", this._errorMessage(err));
        }
        timing.totalMs = this.now() - timing.at;
        this.history.add(timing);
      }
    } finally {
      this.working = false;
      this._idle();
    }
  }

  // Adds a model to the timing and returns the function that records how its
  // request, sent at `startedAt`, ended. A slow model can end after the entry
  // is in the history.
  _trackModel(timing, label, startedAt, primary = false) {
    const model = { label, ms: null, status: "pending", typed: false };
    if (primary) model.primary = true;
    timing.models.push(model);
    return (status, err) => {
      model.ms = this.now() - startedAt;
      model.status = status;
      if (status === "failed") model.error = (err && err.code) || "ERROR";
      this.history.update(timing);
      return model;
    };
  }

  // The live text is already typed (or queued); what is left is the final
  // transcript, any text confirmed after release, and an optional summary.
  async _finishLive(rec, mode, cfg, timing) {
    this.lastTranscripts = [];
    const settle = this._trackModel(timing, "Microsoft (live)", this.now());
    let transcript;
    try {
      transcript = await rec.session.finish();
    } catch (err) {
      settle("failed", err);
      this._flushLive(rec);
      await rec.lane.close();
      throw err;
    }
    settle(transcript ? "ok" : "empty").typed = Boolean(transcript);
    this._flushLive(rec);
    if (transcript) this.lastTranscripts.push({ label: "Microsoft", text: transcript });
    // The service streams the transcript as deltas; this only matters if it
    // ever sends the final transcript alone.
    if (!rec.typedAny && transcript) {
      rec.lane.push(transcript);
      rec.typedAny = true;
    }
    let chars = (transcript || "").length;
    if (mode === "summary" && transcript) {
      const summary = await this._summarizeOrNotify(transcript, cfg, timing);
      if (summary) {
        const rest = separatorText(cfg.separator) + summary;
        rec.lane.push(rest);
        chars += rest.length;
      }
    }
    const closeAt = this.now();
    await rec.lane.close();
    timing.typingMs = this.now() - closeAt;
    timing.chars = chars;
  }

  // Asks every selected model at the same time and types one non-empty
  // transcript (see _pickWinner); later answers and failures are ignored.
  // Microsoft runs both its non-streaming model and, when a session ran during
  // the hold, the session's final transcript.
  async _race(bytes, mode, cfg, rec, timing) {
    const models = cfg.transcriptionModels || ["mistral"];
    const transcripts = [];
    this.lastTranscripts = transcripts;
    const runs = [];
    const startedAt = this.now();
    // An empty transcript rejects with null, so a faster silent answer does
    // not hide a slower real one.
    const add = (label, provider, run) => {
      const primary = provider === cfg.primaryModel;
      const settle = this._trackModel(timing, label, startedAt, primary);
      runs.push({
        primary,
        promise: run.then(
          (t) => {
            const model = settle(t ? "ok" : "empty");
            if (!t) return Promise.reject(null);
            transcripts.push({ label, text: t });
            return { model, text: t };
          },
          (err) => {
            settle("failed", err);
            throw err;
          }
        ),
      });
    };
    if (models.includes("mistral")) {
      add(
        "Mistral",
        "mistral",
        this.transcribe(bytes, { apiKey: this.getApiKey(), model: cfg.model, language: cfg.language })
      );
    }
    if (models.includes("google")) {
      add("Google", "google", this.googleTranscribe(bytes, { apiKey: this.getGoogleApiKey(), language: cfg.language }));
    }
    if (models.includes("microsoft")) {
      add("Microsoft", "microsoft", this.microsoftTranscribe(bytes, {
        apiKey: this.getMicrosoftApiKey(),
        endpoint: cfg.microsoftEndpoint,
        language: cfg.language,
      }));
    }
    if (rec) add("Microsoft (live)", "microsoft", rec.session.finish());

    const winner = await this._pickWinner(runs, timing, startedAt);
    if (!winner) {
      // Every model failed or heard nothing; the first real error is reported.
      const settled = await Promise.allSettled(runs.map((run) => run.promise));
      const failure = settled.map((result) => result.reason).find(Boolean);
      if (failure) throw failure;
      return;
    }
    winner.model.typed = true;
    await this._typeResult(winner.text, mode, cfg, timing);
  }

  // Resolves with the run whose text is typed, or with null when no model gave
  // a text. Without a primary model the first text wins. With one, the text of
  // the primary wins if it comes before the limit: PRIMARY_PATIENCE times the
  // answer time of the first other model. A primary that fails or hears
  // nothing ends the wait immediately.
  async _pickWinner(runs, timing, startedAt) {
    const first = (list) => Promise.any(list.map((run) => run.promise)).catch(() => null);
    const preferred = runs.filter((run) => run.primary);
    const others = runs.filter((run) => !run.primary);
    if (preferred.length === 0 || others.length === 0) return first(runs);

    const fromPrimary = first(preferred);
    const fromOthers = first(others);
    const early = await Promise.race([
      fromPrimary.then((winner) => ({ primary: winner })),
      fromOthers.then((winner) => ({ other: winner })),
    ]);
    if ("primary" in early) return early.primary || fromOthers;
    if (!early.other) return fromPrimary;

    const waitFrom = this.now();
    const timedOut = {};
    const late = await Promise.race([
      fromPrimary,
      this.wait((waitFrom - startedAt) * (PRIMARY_PATIENCE - 1)).then(() => timedOut),
    ]);
    timing.primaryWaitMs = this.now() - waitFrom;
    return late === timedOut || late === null ? early.other : late;
  }

  async _typeResult(text, mode, cfg, timing) {
    const summary = mode === "summary" ? await this._summarizeOrNotify(text, cfg, timing) : null;
    const startedAt = this.now();
    if (summary) await this._safeType(() => this.typer.typeParts([text, summary], cfg.separator));
    else await this._safeType(() => this.typer.type(text));
    timing.typingMs = this.now() - startedAt;
    timing.chars = text.length + (summary ? separatorText(cfg.separator).length + summary.length : 0);
  }

  // Returns the summary, or null after telling the user it failed.
  async _summarizeOrNotify(text, cfg, timing) {
    const startedAt = this.now();
    try {
      const isGoogle = cfg.summaryModel.startsWith("google/");
      const model = cfg.summaryModel.replace(/^(google|mistral)\//, "");
      const summarizeFn = isGoogle ? this.googleSummarize : this.summarize;
      const apiKey = isGoogle ? this.getGoogleApiKey() : this.getApiKey();

      return await summarizeFn(text, {
        apiKey,
        model,
        prompt: cfg.summaryPrompt,
        timeoutMs: 10000,
        maxAttempts: 1,
      });
    } catch (err) {
      console.error("VoiceTyper: summarization failed", err);
      this.notify("VoiceTyper", "Summary failed — typed transcript only");
      timing.summaryFailed = true;
      return null;
    } finally {
      timing.summaryMs = this.now() - startedAt;
    }
  }

  async _safeType(fn) {
    try {
      await fn();
    } catch (err) {
      if (err && err.code === "MODIFIER_HELD") {
        this._divertToClipboard(err.remaining || "");
        return;
      }
      console.error("VoiceTyper: typing failed", err);
      this.notify("VoiceTyper", "Typing failed");
    }
  }

  // One transcript is copied as it is; several are labelled by model.
  _copyTranscripts() {
    const list = this.lastTranscripts;
    if (list.length === 0) {
      this.notify("VoiceTyper", "No transcript to copy yet");
      return;
    }
    const text = list.length === 1 ? list[0].text : list.map((t) => `[${t.label}]\n${t.text}`).join("\n\n");
    try {
      this.copyToClipboard(text);
    } catch (err) {
      console.error("VoiceTyper: clipboard write failed", err);
      this.notify("VoiceTyper", "Could not copy to the clipboard");
      return;
    }
    this.notify("VoiceTyper", list.length === 1 ? "Transcript copied" : `${list.length} transcripts copied`);
  }

  // Typing stopped because Shift, Ctrl, Alt or Win stayed down; continuing
  // would have typed shortcuts instead of text.
  _divertToClipboard(text) {
    if (text && this.copyToClipboard) {
      try {
        this.copyToClipboard(text);
        this.notify("VoiceTyper", "A modifier key was held — the rest of the text is on the clipboard");
        return;
      } catch (err) {
        console.error("VoiceTyper: clipboard write failed", err);
      }
    }
    this.notify("VoiceTyper", "A modifier key was held — typing stopped");
  }

  _errorMessage(err) {
    const provider = PROVIDER_LABELS[err && err.name] || "Mistral";
    switch (err && err.code) {
      case "NO_API_KEY":
        return `Set your ${provider} API key in Settings`;
      case "NO_ENDPOINT":
        return "Set your Microsoft endpoint in Settings";
      case "NOT_FOUND":
        return "Microsoft endpoint or deployment not found — check Settings";
      case "UNAUTHORIZED":
        return `Invalid ${provider} API key`;
      case "RATE_LIMIT":
        return "Rate limited — try again";
      case "TOO_LARGE":
        return "Recording too long for Google — try a shorter dictation";
      case "TIMEOUT":
        return `${provider} transcription timed out`;
      case "NETWORK":
        return "Network error — check your connection";
      default:
        return "Transcription failed";
    }
  }
}

module.exports = { Controller };
