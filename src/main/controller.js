class Controller {
  constructor(deps) {
    this.hotkey = deps.hotkey;
    this.recorder = deps.recorder;
    this.transcribe = deps.transcribe;
    this.typer = deps.typer;
    this.tray = deps.tray;
    this.getApiKey = deps.getApiKey;
    this.getConfig = deps.getConfig;
    this.notify = deps.notify;
    this.minDurationMs = deps.minDurationMs != null ? deps.minDurationMs : 200;
    this.sampleRate = deps.sampleRate || 16000;

    this.paused = false;
    this.recording = false;
    this.working = false;
    this.queue = [];
  }

  start() {
    this.hotkey.on("record-start", () => this._onStart());
    this.hotkey.on("record-stop", () => this._onStop());
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
    this._setState("recording");
    this.recorder.start();
  }

  _onStop() {
    if (!this.recording) return;
    this.recording = false;
    this.recorder.stop();
  }

  _onWav(bytes) {
    const samples = (bytes.length - 44) / 2;
    const durationMs = (samples / this.sampleRate) * 1000;
    if (durationMs < this.minDurationMs) {
      this._idle();
      return;
    }
    this.queue.push(bytes);
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
        const bytes = this.queue.shift();
        this._setState("processing");
        try {
          const cfg = this.getConfig();
          const text = await this.transcribe(bytes, {
            apiKey: this.getApiKey(),
            model: cfg.model,
            language: cfg.language,
          });
          if (text) await this.typer.type(text);
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
