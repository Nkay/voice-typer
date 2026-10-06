const { createTypingLanes } = require("./typingLanes.js");
const { separatorText } = require("./typer.js");

const PROVIDER_LABELS = { MicrosoftError: "Microsoft", GoogleError: "Google" };

// Two taps this short, the second this soon after the first, are a double
// press. It is known only at the second release, so a longer second press
// still records.
const DOUBLE_PRESS_MS = 400;

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
    this.getConfig = deps.getConfig;
    this.notify = deps.notify;
    this.minDurationMs = deps.minDurationMs != null ? deps.minDurationMs : 200;
    this.minHoldMs = deps.minHoldMs != null ? deps.minHoldMs : 1000;
    this.now = deps.now || Date.now;
    this.sampleRate = deps.sampleRate || 16000;

    this.paused = false;
    this.recording = false;
    this.working = false;
    this.queue = [];
    this.pressedAt = 0;
    this.lastHoldMs = Infinity;
    this.releasedAt = -Infinity;
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
    if (this.recording) return;
    // Here, not only when Microsoft is checked: a stale live lane blocks every
    // later dictation, whatever the models are now.
    this._dropStaleStreams();

    const models = cfg.transcriptionModels || ["mistral"];
    const streams = models.includes("microsoft");
    const captureId = ++this.captureSeq;
    if (streams && !this._openStream(captureId, models.length === 1, cfg)) return;

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
    this.recording = false;
    const previousHoldMs = this.lastHoldMs;
    const gapMs = this.pressedAt - this.releasedAt;
    this.releasedAt = this.now();
    this.lastHoldMs = this.releasedAt - this.pressedAt;
    this.pendingMode = payload && payload.mode === "summary" ? "summary" : "transcript";
    const rec = this.streams.get(this.currentCaptureId);
    if (rec) rec.stoppedAt = this.now();
    this.recorder.stop();
    // Both taps are too short to type anything; their recordings are dropped.
    if (this.lastHoldMs < DOUBLE_PRESS_MS && previousHoldMs < DOUBLE_PRESS_MS && gapMs < DOUBLE_PRESS_MS) {
      this.releasedAt = -Infinity;
      this._copyTranscripts();
    }
  }

  _onWav(bytes, captureId) {
    const mode = this.pendingMode;
    const rec = this.streams.get(captureId);
    this.streams.delete(captureId);
    const samples = (bytes.length - 44) / 2;
    const durationMs = (samples / this.sampleRate) * 1000;
    if (this.lastHoldMs < this.minHoldMs || durationMs < this.minDurationMs) {
      if (rec) this._discardStream(rec);
      this._idle();
      return;
    }
    if (rec) {
      rec.qualified = true;
      this._flushLive(rec);
    }
    this.queue.push({ bytes, mode, rec });
    this._pump().catch((err) => console.error("VoiceTyper: pump failed", err));
  }

  async _pump() {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length > 0) {
        const { bytes, mode, rec } = this.queue.shift();
        this._setState("processing");
        try {
          const cfg = this.getConfig();
          if (rec && rec.lane) await this._finishLive(rec, mode, cfg);
          else await this._race(bytes, mode, cfg, rec);
        } catch (err) {
          this._setState("error");
          this.notify("VoiceTyper", this._errorMessage(err));
        }
      }
    } finally {
      this.working = false;
      this._idle();
    }
  }

  // The live text is already typed (or queued); what is left is the final
  // transcript, any text confirmed after release, and an optional summary.
  async _finishLive(rec, mode, cfg) {
    this.lastTranscripts = [];
    let transcript;
    try {
      transcript = await rec.session.finish();
    } catch (err) {
      this._flushLive(rec);
      await rec.lane.close();
      throw err;
    }
    this._flushLive(rec);
    if (transcript) this.lastTranscripts.push({ label: "Microsoft", text: transcript });
    // The service streams the transcript as deltas; this only matters if it
    // ever sends the final transcript alone.
    if (!rec.typedAny && transcript) {
      rec.lane.push(transcript);
      rec.typedAny = true;
    }
    if (mode === "summary" && transcript) {
      const summary = await this._summarizeOrNotify(transcript, cfg);
      if (summary) rec.lane.push(separatorText(cfg.separator) + summary);
    }
    await rec.lane.close();
  }

  // Asks every selected model at the same time and types the first non-empty
  // transcript; later answers and failures are ignored. Microsoft runs both
  // its non-streaming model and, when a session ran during the hold, the
  // session's final transcript.
  async _race(bytes, mode, cfg, rec) {
    const models = cfg.transcriptionModels || ["mistral"];
    const transcripts = [];
    this.lastTranscripts = transcripts;
    const runs = [];
    const add = (label, run) =>
      runs.push(run.then((t) => {
        if (t) transcripts.push({ label, text: t });
        return t;
      }));
    if (models.includes("mistral")) {
      add("Mistral", this.transcribe(bytes, { apiKey: this.getApiKey(), model: cfg.model, language: cfg.language }));
    }
    if (models.includes("google")) {
      add("Google", this.googleTranscribe(bytes, { apiKey: this.getGoogleApiKey(), language: cfg.language }));
    }
    if (models.includes("microsoft")) {
      add("Microsoft", this.microsoftTranscribe(bytes, {
        apiKey: this.getMicrosoftApiKey(),
        endpoint: cfg.microsoftEndpoint,
        language: cfg.language,
      }));
    }
    if (rec) add("Microsoft (live)", rec.session.finish());

    let text;
    try {
      // An empty transcript rejects with null, so a faster silent answer does
      // not hide a slower real one.
      text = await Promise.any(runs.map((run) => run.then((t) => t || Promise.reject(null))));
    } catch (err) {
      // Every model failed or heard nothing; the first real error is reported.
      const failure = err.errors.find(Boolean);
      if (failure) throw failure;
      return;
    }
    await this._typeResult(text, mode, cfg);
  }

  async _typeResult(text, mode, cfg) {
    if (mode !== "summary") {
      await this._safeType(() => this.typer.type(text));
      return;
    }

    const summary = await this._summarizeOrNotify(text, cfg);
    if (!summary) {
      await this._safeType(() => this.typer.type(text));
      return;
    }
    await this._safeType(() => this.typer.typeParts([text, summary], cfg.separator));
  }

  // Returns the summary, or null after telling the user it failed.
  async _summarizeOrNotify(text, cfg) {
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
      return null;
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
