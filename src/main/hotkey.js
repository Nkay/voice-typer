const EventEmitter = require("events");

class Hotkey extends EventEmitter {
  constructor({ keyName, createListener }) {
    super();
    this.keyName = String(keyName).toUpperCase();
    this.createListener = createListener;
    this.listener = null;
    this.down = false;
  }

  start() {
    this.listener = this.createListener();
    this.listener.addListener((e) => this._onKey(e));
  }

  _onKey(e) {
    if (!e || String(e.name).toUpperCase() !== this.keyName) return;
    if (e.state === "DOWN") {
      if (!this.down) {
        this.down = true;
        this.emit("record-start");
      }
    } else if (e.state === "UP") {
      if (this.down) {
        this.down = false;
        this.emit("record-stop");
      }
    }
  }

  setKey(name) {
    this.keyName = String(name).toUpperCase();
    this.down = false;
  }

  stop() {
    if (this.listener && typeof this.listener.kill === "function") this.listener.kill();
    this.listener = null;
  }
}

module.exports = { Hotkey };
