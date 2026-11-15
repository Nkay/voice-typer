import { describe, it, expect } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import { createRecordings } from "../src/main/recordings.js";

const tmpDir = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "voicetyper-rec-")), "recordings");
const at = (ms) => new Date(2026, 10, 15, 16, 5, 19, ms).getTime();

describe("recordings", () => {
  it("saves the audio under its local start time and reads it back", () => {
    const recordings = createRecordings({ dir: tmpDir() });
    const name = recordings.save(Buffer.from("RIFF"), at(7));

    expect(name).toBe("2026-11-15_16-05-19-007");
    expect(recordings.read(name).toString()).toBe("RIFF");
  });

  it("writes the entry as JSON next to its recording", () => {
    const dir = tmpDir();
    const recordings = createRecordings({ dir });
    const name = recordings.save(Buffer.from("RIFF"), at(1));
    recordings.writeEntry({ recording: name, text: "thank you" });
    recordings.writeEntry({ recording: null, text: "no audio" });

    expect(JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")).text).toBe("thank you");
    expect(fs.readdirSync(dir).sort()).toEqual([`${name}.json`, `${name}.wav`]);
  });

  it("keeps only the newest recordings, with their JSON", () => {
    const dir = tmpDir();
    const recordings = createRecordings({ dir, limit: 2 });
    const names = [1, 2, 3].map((ms) => recordings.save(Buffer.from("RIFF"), at(ms)));
    recordings.writeEntry({ recording: names[1] });
    recordings.save(Buffer.from("RIFF"), at(4));
    // A late update of a removed recording leaves no file behind.
    recordings.writeEntry({ recording: names[0] });

    expect(fs.readdirSync(dir).sort()).toEqual(["2026-11-15_16-05-19-003.wav", "2026-11-15_16-05-19-004.wav"]);
  });

  it("reads only names that it made", () => {
    const dir = tmpDir();
    const recordings = createRecordings({ dir });
    recordings.save(Buffer.from("RIFF"), at(1));

    expect(recordings.read("../config")).toBeNull();
    expect(recordings.read("2026-11-15_16-05-19-999")).toBeNull();
  });

  it("returns null when the folder cannot be written", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "voicetyper-rec-")), "a-file");
    fs.writeFileSync(file, "");
    const recordings = createRecordings({ dir: file });

    expect(recordings.save(Buffer.from("RIFF"), at(1))).toBeNull();
  });
});
