const fs = require("fs");
const path = require("path");

// The name of a recording is its local start time, so the folder sorts by date.
const NAME = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/;

function nameOf(at) {
  const d = new Date(at);
  const two = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_` +
    `${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, "0")}`
  );
}

// Keeps the audio of the last `limit` dictations as WAV files and, next to
// each, its history entry as JSON: what each model answered and what was
// typed. It is there to find out later where a strange result came from. Like
// the timing history, a failure here never stops a dictation.
function createRecordings({ dir, limit = 500 }) {
  const file = (name, ext) => path.join(dir, `${name}.${ext}`);

  function prune() {
    const names = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".wav"))
      .map((f) => f.slice(0, -4))
      .filter((n) => NAME.test(n))
      .sort();
    for (const name of names.slice(0, Math.max(0, names.length - limit))) {
      for (const ext of ["wav", "json"]) fs.rmSync(file(name, ext), { force: true });
    }
  }

  return {
    dir,
    // Returns the name of the recording, or null when it could not be saved.
    save(wavBytes, at) {
      try {
        const name = nameOf(at);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file(name, "wav"), wavBytes);
        prune();
        return name;
      } catch (err) {
        console.error("VoiceTyper: could not save the recording", err);
        return null;
      }
    },
    writeEntry(entry) {
      // A late answer can update an entry whose recording is already gone.
      if (!entry || !entry.recording || !fs.existsSync(file(entry.recording, "wav"))) return;
      try {
        fs.writeFileSync(file(entry.recording, "json"), JSON.stringify(entry, null, 2), "utf8");
      } catch (err) {
        console.error("VoiceTyper: could not save the dictation log", err);
      }
    },
    // The WAV bytes of a recording, or null. Only a name made by save() is read.
    read(name) {
      if (typeof name !== "string" || !NAME.test(name)) return null;
      try {
        return fs.readFileSync(file(name, "wav"));
      } catch {
        return null;
      }
    },
  };
}

module.exports = { createRecordings };
