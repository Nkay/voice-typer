const { KEY_NAMES, vkFor } = require("../shared/keys.js");

function createKeyPoller({
  getKeyState,
  keys = KEY_NAMES,
  intervalMs = 30,
  timers = { setInterval, clearInterval },
}) {
  const listeners = [];
  let watched = [];
  let down = {};

  // Resets down-state: a key leaving the watch list emits no UP, and a key
  // returning while still held emits a fresh DOWN. Hotkey.setBindings clears its
  // own state at the same moment, so no stale hold survives a rebinding.
  const setKeys = (names) => {
    watched = [];
    down = {};
    for (const name of Array.isArray(names) ? names : []) {
      const vk = vkFor(name);
      if (vk === undefined) continue;
      const upper = name.toUpperCase();
      if (upper in down) continue;
      watched.push({ name: upper, vk });
      down[upper] = false;
    }
  };

  setKeys(keys);

  const tick = () => {
    for (const { name, vk } of watched) {
      const isDown = Boolean(getKeyState(vk));
      if (isDown === down[name]) continue;
      down[name] = isDown;
      const event = { name, state: isDown ? "DOWN" : "UP" };
      for (const cb of listeners) {
        try {
          cb(event);
        } catch (err) {
          console.error("VoiceTyper: hotkey listener callback failed", err);
        }
      }
    }
  };

  const timer = timers.setInterval(tick, intervalMs);

  return {
    addListener(cb) {
      listeners.push(cb);
    },
    setKeys,
    kill() {
      timers.clearInterval(timer);
    },
  };
}

function createWin32KeyState() {
  // Lazy require: tests and non-Windows environments never load koffi.
  const koffi = require("koffi");
  const user32 = koffi.load("user32.dll");
  const GetAsyncKeyState = user32.func("short __stdcall GetAsyncKeyState(int vKey)");
  // High bit set = key currently down. Works for negative int16 values.
  return (vk) => (GetAsyncKeyState(vk) & 0x8000) !== 0;
}

module.exports = { createKeyPoller, createWin32KeyState };
