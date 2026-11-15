const fs = require("fs");
const path = require("path");

// The name of a recording is its local start time, so the folder sorts by date.
const NAME = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/;

// Keep in step with the README and history.html, which name the number.
const LIMIT = 500;

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
//
// The files are written in the background: a dictation must not wait for the
// disk. The writes of one recording run in order.
function createRecordings({ dir, limit = LIMIT, fsp = fs.promises }) {
  const file = (name, ext) => path.join(dir, `${name}.${ext}`);
  // Per recording: the promise of its last write.
  const writes = new Map();
  const chain = (name, step) => {
    const next = (writes.get(name) || Promise.resolve()).then(step);
    writes.set(name, next);
    return next;
  };

  async function prune() {
    try {
      const names = (await fsp.readdir(dir))
        .filter((f) => f.endsWith(".wav"))
        .map((f) => f.slice(0, -4))
        .filter((n) => NAME.test(n))
        .sort();
      for (const name of names.slice(0, Math.max(0, names.length - limit))) {
        writes.delete(name);
        for (const ext of ["wav", "json"]) await fsp.rm(file(name, ext), { force: true });
      }
    } catch (err) {
      console.error("VoiceTyper: could not remove old recordings", err);
    }
  }

  return {
    dir,
    // Returns the name of the recording at once; the file follows.
    save(wavBytes, at) {
      const name = nameOf(at);
      chain(name, async () => {
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(file(name, "wav"), wavBytes);
        await prune();
      }).catch((err) => {
        writes.delete(name);
        console.error("VoiceTyper: could not save the recording", err);
      });
      return name;
    },
    writeEntry(entry) {
      if (!entry || !entry.recording || !writes.has(entry.recording)) return;
      const name = entry.recording;
      const json = JSON.stringify(entry, null, 2);
      chain(name, async () => {
        // A late answer can update an entry whose recording is already gone.
        if (!writes.has(name)) return;
        await fsp.writeFile(file(name, "json"), json, "utf8");
      }).catch((err) => console.error("VoiceTyper: could not save the dictation log", err));
    },
    // The WAV bytes of a recording, or null. Only a name made by save() is read.
    async read(name) {
      if (typeof name !== "string" || !NAME.test(name)) return null;
      await writes.get(name)?.catch(() => {});
      try {
        return await fsp.readFile(file(name, "wav"));
      } catch {
        return null;
      }
    },
    // Resolves when every write so far is done; for tests.
    idle() {
      return Promise.allSettled([...writes.values()]).then(() => {});
    },
  };
}

module.exports = { createRecordings, LIMIT };
