class Controller {
  constructor(deps) {
    this.hotkey = deps.hotkey;
    this.recorder = deps.recorder;
    this.transcribe = deps.transcribe;
    this.summarize = deps.summarize;
    this.typer = deps.typer;
    this.tray = deps.tray;
    this.getApiKey = deps.getApiKey;
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
    // Infinity = no completed press cycle yet; such clips pass the guard.
    this.lastHoldMs = Infinity;
    // Mode of the most recently stopped recording, captured at record-stop
    // time. A single slot, not a queue: recordings are serialised (_onStart
    // returns early while already recording) and stop -> handlePcm is a
    // sub-5ms IPC round trip while a fresh hold takes at least a second, so a
    // second stop cannot realistically land before the pending WAV. If a WAV
    // is lost entirely (e.g. getUserMedia rejected, so capture:pcm never
    // arrives), this leaves one stale value that the next record-stop simply
    // overwrites — harmless, unlike a FIFO queue permanently desyncing.
    this.pendingMode = "transcript";
  }

  start() {
    this.hotkey.on("record-start", () => this._onStart());
    this.hotkey.on("record-stop", (payload) => this._onStop(payload));
    this.recorder.onWav((bytes) => this._onWav(bytes));
    this._idle();
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    this._idle();
  }

  isPaused() {
    return this.paused;
  }

  refreshKeyState() {
    this._idle();
  }

  _idle() {
    if (this.paused) return this._setState("paused");
    this._setState(this.getApiKey() ? "active" : "error");
  }

  _setState(state) {
    this.state = state;
    this.tray.setState(state);
  }

  _onStart() {
    if (this.paused) return;
    if (!this.getApiKey()) {
      this.notify("VoiceTyper", "Set your Mistral API key in Settings");
      this._setState("error");
      return;
    }
    if (this.recording) return;
    this.recording = true;
    this.pressedAt = this.now();
    this._setState("recording");
    this.recorder.start();
  }

  _onStop(payload) {
    if (!this.recording) return;
    this.recording = false;
    this.lastHoldMs = this.now() - this.pressedAt;
    this.pendingMode = payload && payload.mode === "summary" ? "summary" : "transcript";
    this.recorder.stop();
  }

  _onWav(bytes) {
    const mode = this.pendingMode;
    const samples = (bytes.length - 44) / 2;
    const durationMs = (samples / this.sampleRate) * 1000;
    if (this.lastHoldMs < this.minHoldMs || durationMs < this.minDurationMs) {
      this._idle();
      return;
    }
    this.queue.push({ bytes, mode });
    // _pump() is fire-and-forget here; its own try/finally already resets
    // `working` on any failure, but a synchronous throw from _setState
    // (e.g. tray.setState) would otherwise escape as an unhandled
    // rejection and crash the process. Swallow it defensively — the
    // recovery already happened inside _pump's finally block.
    this._pump().catch((err) => console.error("VoiceTyper: pump failed", err));
  }

  async _pump() {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length > 0) {
        const { bytes, mode } = this.queue.shift();
        this._setState("processing");
        try {
          const cfg = this.getConfig();
          const text = await this.transcribe(bytes, {
            apiKey: this.getApiKey(),
            model: cfg.model,
            language: cfg.language,
          });
          if (text) await this._typeResult(text, mode, cfg);
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

  // A failed summary must never cost the user their dictation: the transcript is
  // typed regardless, and the tray stays out of the error state because the
  // recording itself succeeded.
  async _typeResult(text, mode, cfg) {
    if (mode !== "summary") {
      await this._safeType(() => this.typer.type(text));
      return;
    }

    let summary;
    try {
      // Nothing is typed until this settles, so a stalled endpoint must not
      // delay the transcript the way its own retry-happy defaults would: cap
      // the wait and don't retry. The transcript already exists regardless.
      summary = await this.summarize(text, {
        apiKey: this.getApiKey(),
        model: cfg.summaryModel,
        prompt: cfg.summaryPrompt,
        timeoutMs: 10000,
        maxAttempts: 1,
      });
    } catch (err) {
      console.error("VoiceTyper: summarization failed", err);
      this.notify("VoiceTyper", "Summary failed — typed transcript only");
      await this._safeType(() => this.typer.type(text));
      return;
    }

    await this._safeType(() => this.typer.typeParts([text, summary], cfg.separator));
  }

  // Typing happens after transcription (and, in summary mode, summarization)
  // has already succeeded, so a keystroke-synthesis failure here is a distinct
  // failure mode: it must not be reported as "Transcription failed" and must
  // not redden the tray, since transcription itself worked fine.
  async _safeType(fn) {
    try {
      await fn();
    } catch (err) {
      console.error("VoiceTyper: typing failed", err);
      this.notify("VoiceTyper", "Typing failed");
    }
  }

  _errorMessage(err) {
    switch (err && err.code) {
      case "NO_API_KEY":
        return "Set your Mistral API key in Settings";
      case "UNAUTHORIZED":
        return "Invalid Mistral API key";
      case "RATE_LIMIT":
        return "Rate limited — try again";
      case "NETWORK":
        return "Network error — check your connection";
      default:
        return "Transcription failed";
    }
  }
}

module.exports = { Controller };
