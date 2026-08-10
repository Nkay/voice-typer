const JOINERS = { dash: " — ", spaces: "  " };

function createTyper({ keyboard, Key }) {
  // A raw "\n" handed to nut-js becomes a bare Enter, which submits chat inputs.
  // Shift+Enter is a newline everywhere that matters and submits nowhere.
  const softNewline = async () => {
    await keyboard.pressKey(Key.LeftShift, Key.Enter);
    await keyboard.releaseKey(Key.LeftShift, Key.Enter);
  };

  const type = async (text) => {
    if (!text) return;
    await keyboard.type(text);
  };

  return {
    type,

    async typeParts(parts, separator = "blank-line") {
      const usable = (Array.isArray(parts) ? parts : []).filter(
        (p) => typeof p === "string" && p.length > 0
      );
      if (usable.length === 0) return;

      const joiner = JOINERS[separator];
      if (joiner !== undefined) {
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
