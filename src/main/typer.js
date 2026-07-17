function createTyper({ keyboard }) {
  return {
    async type(text) {
      if (!text) return;
      await keyboard.type(text);
    },
  };
}

module.exports = { createTyper };
