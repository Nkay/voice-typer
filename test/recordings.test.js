import { describe, it, expect } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import { createRecordings } from "../src/main/recordings.js";

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "voicetyper-rec-"));
const tmpDir = () => path.join(tmpRoot(), "recordings");
const at = (ms) => new Date(2026, 10, 15, 16, 5, 19, ms).getTime();

describe("recordings", () => {
  it("names the recording by its local start time at once and reads it back", async () => {
    const recordings = createRecordings({ dir: tmpDir() });
    const name = recordings.save(Buffer.from("RIFF"), at(7));

    expect(name).toBe("2026-11-15_16-05-19-007");
    // read() waits for the write that is still running.
    expect((await recordings.read(name)).toString()).toBe("RIFF");
  });

  it("writes the entry as JSON next to its recording, the last version last", async () => {
    const dir = tmpDir();
    const recordings = createRecordings({ dir });
    const name = recordings.save(Buffer.from("RIFF"), at(1));
    recordings.writeEntry({ recording: name, text: "first" });
    recordings.writeEntry({ recording: name, text: "thank you" });
    recordings.writeEntry({ recording: null, text: "no audio" });
    await recordings.idle();

    expect(JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")).text).toBe("thank you");
    expect(fs.readdirSync(dir).sort()).toEqual([`${name}.json`, `${name}.wav`]);
  });

  it("keeps only the newest recordings, with their JSON", async () => {
    const dir = tmpDir();
    const recordings = createRecordings({ dir, limit: 2 });
    const names = [1, 2, 3].map((ms) => recordings.save(Buffer.from("RIFF"), at(ms)));
    recordings.writeEntry({ recording: names[1] });
    await recordings.idle();
    recordings.save(Buffer.from("RIFF"), at(4));
    await recordings.idle();
    // A late update of a removed recording leaves no file behind.
    recordings.writeEntry({ recording: names[0] });
    await recordings.idle();

    expect(fs.readdirSync(dir).sort()).toEqual(["2026-11-15_16-05-19-003.wav", "2026-11-15_16-05-19-004.wav"]);
  });

  it("reads only names that it made", async () => {
    const recordings = createRecordings({ dir: tmpDir() });
    recordings.save(Buffer.from("RIFF"), at(1));
    await recordings.idle();

    expect(await recordings.read("../config")).toBeNull();
    expect(await recordings.read("2026-11-15_16-05-19-999")).toBeNull();
  });

  it("writes no JSON for a recording that could not be saved", async () => {
    const file = path.join(tmpRoot(), "a-file");
    fs.writeFileSync(file, "");
    const recordings = createRecordings({ dir: file });
    const name = recordings.save(Buffer.from("RIFF"), at(1));
    await recordings.idle();
    recordings.writeEntry({ recording: name });
    await recordings.idle();

    expect(await recordings.read(name)).toBeNull();
    expect(fs.readFileSync(file, "utf8")).toBe("");
  });

  it("keeps the recording when old ones cannot be removed", async () => {
    const dir = tmpDir();
    const fsp = { ...fs.promises, readdir: async () => Promise.reject(new Error("locked")) };
    const recordings = createRecordings({ dir, limit: 1, fsp });
    const name = recordings.save(Buffer.from("RIFF"), at(1));
    recordings.writeEntry({ recording: name, text: "kept" });
    await recordings.idle();

    expect(fs.readdirSync(dir).sort()).toEqual([`${name}.json`, `${name}.wav`]);
  });
});
