const JOINERS = { dash: " — ", spaces: "  " };

function createTyper({ keyboard, Key }) {
  // A raw "\n" handed to nut-js becomes a bare Enter, which submits chat inputs.
  // Shift+Enter is a newline everywhere that matters and submits nowhere.
  // Key.Return (not Key.Enter, which is numpad-enter) is the main Return key —
  // the one "Shift+Enter means soft newline" is a convention about.
  const softNewline = async () => {
    await keyboard.pressKey(Key.LeftShift, Key.Return);
    await keyboard.releaseKey(Key.LeftShift, Key.Return);
  };

  // A raw "\n" must never reach keyboard.type: both the plain transcript and
  // each part handed to typeParts are model output, and either can contain a
  // newline nut-js would turn into a bare Enter press. Route every newline
  // through softNewline instead.
  const type = async (text) => {
    if (!text) return;
    const lines = String(text).split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) await softNewline();
      if (lines[i]) await keyboard.type(lines[i]);
    }
  };

  return {
    type,

    async typeParts(parts, separator = "blank-line") {
      const usable = (Array.isArray(parts) ? parts : []).filter(
        (p) => typeof p === "string" && p.length > 0
      );
      if (usable.length === 0) return;

      const joiner = JOINERS[separator];
      if (typeof joiner === "string") {
        await type(usable.join(joiner));
        return;
      }

      for (let i = 0; i < usable.length; i++) {
        if (i > 0) {
          await softNewline();
          await softNewline();
        }
        await type(usable[i]);
      }
    },
  };
}

module.exports = { createTyper };
