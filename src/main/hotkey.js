const EventEmitter = require("events");

function norm(name) {
  return typeof name === "string" ? name.toUpperCase() : null;
}

// Routes two independent bindings — a single record key and a two-key summary
// chord — into record-start/record-stop, tagging each recording with a mode.
// Config validation guarantees the record key is not part of the chord, so the
// two bindings can never contend for the same physical key.
class Hotkey extends EventEmitter {
  constructor({ recordKey, summaryKeys = [], createListener }) {
    super();
    this.createListener = createListener;
    this.listener = null;
    this.downKeys = new Set();
    this.mode = null; // null while not recording
    this._applyBindings({ recordKey, summaryKeys });
  }

  _applyBindings({ recordKey, summaryKeys }) {
    this.recordKey = norm(recordKey);
    const chord = Array.isArray(summaryKeys) ? summaryKeys.map(norm) : [];
    this.summaryKeys = chord.length === 2 && chord.every(Boolean) ? chord : [];
  }

  watchedKeys() {
    return [this.recordKey, ...this.summaryKeys].filter(Boolean);
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
    this._evaluate();
  }

  _evaluate() {
    const chordDown =
      this.summaryKeys.length === 2 && this.summaryKeys.every((k) => this.downKeys.has(k));
    const recordDown = Boolean(this.recordKey) && this.downKeys.has(this.recordKey);

    if (!this.mode) {
      // The chord wins when both could start, but validation makes that
      // impossible in practice — the bindings share no key.
      if (chordDown) {
        this.mode = "summary";
        this.emit("record-start", { mode: "summary" });
      } else if (recordDown) {
        this.mode = "transcript";
        this.emit("record-start", { mode: "transcript" });
      }
      return;
    }

    // Mode is locked for the duration of a hold: only the binding that started
    // the recording can end it.
    const stillHeld = this.mode === "summary" ? chordDown : recordDown;
    if (!stillHeld) {
      this.mode = null;
      this.emit("record-stop");
    }
  }

  setBindings({ recordKey, summaryKeys }) {
    this._applyBindings({ recordKey, summaryKeys });
    // Drop any hold in progress: the keys it referred to may no longer be bound.
    this.downKeys.clear();
    this.mode = null;
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
