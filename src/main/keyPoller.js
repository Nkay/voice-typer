// Values must match the settings dropdown (src/settings/settings.html).
const KEY_VCODES = {
  "RIGHT ALT": 0xa5, // VK_RMENU
  "LEFT ALT": 0xa4, // VK_LMENU
  "RIGHT CTRL": 0xa3, // VK_RCONTROL
  "LEFT CTRL": 0xa2, // VK_LCONTROL
};

// Emits the same { name, state: "DOWN"|"UP" } events and addListener/kill
// surface as node-global-key-listener's GlobalKeyboardListener, so Hotkey
// consumes it unchanged. Polling GetAsyncKeyState installs no keyboard
// hook and spawns no helper process — nothing for AV heuristics to flag.
function createKeyPoller({
  getKeyState,
  intervalMs = 30,
  timers = { setInterval, clearInterval },
}) {
  const listeners = [];
  const down = {};
  for (const name of Object.keys(KEY_VCODES)) down[name] = false;

  const tick = () => {
    for (const [name, vk] of Object.entries(KEY_VCODES)) {
      const isDown = Boolean(getKeyState(vk));
      if (isDown === down[name]) continue;
      down[name] = isDown;
      const event = { name, state: isDown ? "DOWN" : "UP" };
      for (const cb of listeners) cb(event);
    }
  };

  const timer = timers.setInterval(tick, intervalMs);

  return {
    addListener(cb) {
      listeners.push(cb);
    },
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

module.exports = { createKeyPoller, createWin32KeyState, KEY_VCODES };
