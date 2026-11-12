const fs = require("fs");

// The timings of the last dictations, newest last in the file. An entry holds
// durations and character counts only, never the dictated text.
//
// The history is a diagnostic: a file that cannot be read or written must
// never stop a dictation, so every file error is swallowed.
function createTimingHistory({ filePath, limit = 50, onChange = () => {} }) {
  let entries = load();

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!Array.isArray(parsed)) return [];
      const usable = parsed.filter((e) => e && typeof e === "object" && Array.isArray(e.models)).slice(-limit);
      // A model that was still running when the app closed never answers now.
      for (const entry of usable) {
        for (const model of entry.models) {
          if (model.status === "pending") model.status = "unfinished";
        }
      }
      return usable;
    } catch {
      return [];
    }
  }

  function changed() {
    try {
      fs.writeFileSync(filePath, JSON.stringify(entries), "utf8");
    } catch (err) {
      console.error("VoiceTyper: could not write the timing history", err);
    }
    onChange();
  }

  return {
    add(entry) {
      entries.push(entry);
      if (entries.length > limit) entries = entries.slice(-limit);
      changed();
    },
    // For a change of an entry after add(): a slower model of a race answers
    // after the text is typed.
    update(entry) {
      if (entries.includes(entry)) changed();
    },
    clear() {
      entries = [];
      changed();
    },
    // Newest first.
    list() {
      return entries.slice().reverse();
    },
  };
}

module.exports = { createTimingHistory };
