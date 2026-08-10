const EventEmitter = require("events");

function norm(name) {
  return typeof name === "string" ? name.toUpperCase() : null;
}

// Routes a single record key, optionally upgraded by a modifier, into
// record-start/record-stop. Recording starts and stops on the record key
// alone; the modifier only decides which mode record-stop reports. It is
// sticky within a hold — once seen down (at start, or at any point before
// release) it stays counted even if released early — so the mode can only be
// known for certain at release, not at start.
class Hotkey extends EventEmitter {
  constructor({ recordKey, summaryModifier, createListener }) {
    super();
    this.createListener = createListener;
    this.listener = null;
    this.downKeys = new Set();
    this.recording = false;
    this.sticky = false;
    this._applyBindings({ recordKey, summaryModifier });
  }

  _applyBindings({ recordKey, summaryModifier }) {
    this.recordKey = norm(recordKey);
    this.summaryModifier = norm(summaryModifier) || null;
  }

  watchedKeys() {
    return [this.recordKey, this.summaryModifier].filter(Boolean);
  }

  start() {
    this.listener = this.createListener(this.watchedKeys());
    this.listener.addListener((e) => this._onKey(e));
  }

  _onKey(e) {
    if (!e) return;
    const name = norm(e.name);
    if (!name || !this.watchedKeys().includes(name)) return;
    if (e.state === "DOWN") this.downKeys.add(name);
    else if (e.state === "UP") this.downKeys.delete(name);
    else return;

    if (name === this.recordKey) {
      if (e.state === "DOWN") this._startIfIdle();
      else this._stopIfRecording();
    } else if (name === this.summaryModifier) {
      // Sticky within a hold: once set, never cleared here — only a fresh
      // record-start (via _startIfIdle) or setBindings resets it.
      if (e.state === "DOWN" && this.recording) this.sticky = true;
    }
  }

  _startIfIdle() {
    if (this.recording) return; // auto-repeat DOWN while already recording
    this.recording = true;
    this.sticky = this.downKeys.has(this.summaryModifier);
    this.emit("record-start");
  }

  _stopIfRecording() {
    if (!this.recording) return;
    const mode = this.sticky ? "summary" : "transcript";
    this.recording = false;
    this.sticky = false;
    this.emit("record-stop", { mode });
  }

  setBindings({ recordKey, summaryModifier }) {
    this._applyBindings({ recordKey, summaryModifier });
    // Drop any hold in progress: the keys it referred to may no longer be bound.
    this.downKeys.clear();
    this.recording = false;
    this.sticky = false;
    if (this.listener && typeof this.listener.setKeys === "function") {
      this.listener.setKeys(this.watchedKeys());
    }
  }

  stop() {
    if (this.listener && typeof this.listener.kill === "function") this.listener.kill();
    this.listener = null;
  }
}

module.exports = { Hotkey };
