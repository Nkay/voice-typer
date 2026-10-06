const JOINERS = { "blank-line": "\n\n", dash: " — ", spaces: "  " };

// The text that goes between a transcript and its summary. "\n\n" becomes two
// soft newlines in type().
function separatorText(separator) {
  return Object.prototype.hasOwnProperty.call(JOINERS, separator) ? JOINERS[separator] : JOINERS["blank-line"];
}

class TyperError extends Error {
  constructor(code, message, remaining) {
    super(message);
    this.name = "TyperError";
    this.code = code;
    // The part of the text that was not typed, so the caller can still hand it
    // to the user another way.
    this.remaining = remaining;
  }
}

// Model output is typed key by key into whatever has focus, so anything that is
// not printable text is a keystroke with side effects: Tab moves focus, Escape
// closes dialogs, Backspace deletes. C0/C1 controls are dropped (Tab becomes a
// space) and newlines are normalised to "\n" for softNewline. Characters above
// U+FFFF (emoji and the like) are dropped as well: they need a surrogate pair,
// which is not delivered reliably as injected input on Windows.
function sanitize(text) {
  return String(text)
    .replace(/\r\n|\r/g, "\n")
    .replace(/\t/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "")
    .replace(/[\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/[\uD800-\uDFFF]/g, "");
}

function createTyper({
  keyboard,
  Key,
  // True while the user physically holds Shift, Ctrl, Alt/AltGr or Win.
  isModifierDown = () => false,
  // True while a dictation hold is in progress. Waiting for the record key to
  // come up is expected then, so that time does not count toward the timeout.
  isHoldActive = () => false,
  modifierTimeoutMs = 10000,
  pollMs = 15,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  // A raw "\n" handed to nut-js becomes a bare Enter, which submits chat inputs.
  // Shift+Enter is a newline everywhere that matters and submits nowhere.
  // Key.Return (not Key.Enter, which is numpad-enter) is the main Return key —
  // the one "Shift+Enter means soft newline" is a convention about.
  const softNewline = async () => {
    await keyboard.pressKey(Key.LeftShift, Key.Return);
    await keyboard.releaseKey(Key.LeftShift, Key.Return);
  };

  // nut-js injects one character at a time, and Windows combines each one with
  // whatever modifiers are physically down at that moment. Checking before every
  // character keeps a key pressed mid-transcript (for example AltGr for the next
  // dictation) from turning the rest of the text into shortcuts.
  const waitForModifiers = async (remaining) => {
    let waitedMs = 0;
    while (isModifierDown()) {
      if (!isHoldActive()) {
        if (waitedMs >= modifierTimeoutMs) {
          throw new TyperError("MODIFIER_HELD", "A modifier key is held down", remaining());
        }
        waitedMs += pollMs;
      }
      await sleep(pollMs);
    }
  };

  // A raw "\n" must never reach keyboard.type: both the plain transcript and
  // each part handed to typeParts are model output, and either can contain a
  // newline nut-js would turn into a bare Enter press. Route every newline
  // through softNewline instead.
  const type = async (text) => {
    if (!text) return;
    const chars = Array.from(sanitize(text));
    for (let i = 0; i < chars.length; i++) {
      await waitForModifiers(() => chars.slice(i).join(""));
      if (chars[i] === "\n") await softNewline();
      else await keyboard.type(chars[i]);
    }
  };

  return {
    type,

    async typeParts(parts, separator = "blank-line") {
      const usable = (Array.isArray(parts) ? parts : []).filter(
        (p) => typeof p === "string" && p.length > 0
      );
      if (usable.length === 0) return;
      await type(usable.join(separatorText(separator)));
    },
  };
}

module.exports = { createTyper, separatorText, sanitize, TyperError };
