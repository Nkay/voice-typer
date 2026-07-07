function createTyper({ keyboard, Key }) {
  return {
    async typeAndEnter(text) {
      if (!text) return;
      await keyboard.type(text);
      await keyboard.pressKey(Key.Enter);
      await keyboard.releaseKey(Key.Enter);
    },
  };
}

module.exports = { createTyper };
