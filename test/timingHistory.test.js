import { describe, it, expect } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import { createTimingHistory } from "../src/main/timingHistory.js";

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicetyper-timings-"));
  return path.join(dir, "timings.json");
}

const entry = (at, extra = {}) => ({ at, models: [], ...extra });

describe("timing history", () => {
  it("lists the newest dictation first", () => {
    const history = createTimingHistory({ filePath: tmpFile() });
    history.add(entry(1));
    history.add(entry(2));

    expect(history.list().map((e) => e.at)).toEqual([2, 1]);
  });

  it("keeps only the newest entries up to the limit", () => {
    const history = createTimingHistory({ filePath: tmpFile(), limit: 2 });
    history.add(entry(1));
    history.add(entry(2));
    history.add(entry(3));

    expect(history.list().map((e) => e.at)).toEqual([3, 2]);
  });

  it("survives a restart", () => {
    const filePath = tmpFile();
    createTimingHistory({ filePath }).add(entry(1, { typingMs: 500 }));

    const reloaded = createTimingHistory({ filePath });

    expect(reloaded.list()).toEqual([entry(1, { typingMs: 500 })]);
  });

  it("stores a later change of an entry it holds", () => {
    const filePath = tmpFile();
    const history = createTimingHistory({ filePath });
    const slow = entry(1, { models: [{ label: "Google", ms: null, status: "pending" }] });
    history.add(slow);

    slow.models[0].ms = 2900;
    slow.models[0].status = "ok";
    history.update(slow);

    expect(createTimingHistory({ filePath }).list()[0].models[0]).toEqual({ label: "Google", ms: 2900, status: "ok" });
  });

  it("ignores a change of an entry it no longer holds", () => {
    const changes = [];
    const history = createTimingHistory({ filePath: tmpFile(), limit: 1, onChange: () => changes.push(1) });
    const dropped = entry(1);
    history.add(dropped);
    history.add(entry(2));
    changes.length = 0;

    history.update(dropped);

    expect(changes).toEqual([]);
  });

  it("reports every change", () => {
    const changes = [];
    const history = createTimingHistory({ filePath: tmpFile(), onChange: () => changes.push(history.list().length) });
    const first = entry(1);

    history.add(first);
    history.update(first);
    history.clear();

    expect(changes).toEqual([1, 1, 0]);
  });

  it("clear empties the list and the file", () => {
    const filePath = tmpFile();
    const history = createTimingHistory({ filePath });
    history.add(entry(1));

    history.clear();

    expect(history.list()).toEqual([]);
    expect(createTimingHistory({ filePath }).list()).toEqual([]);
  });

  it("starts empty when the file is damaged", () => {
    const filePath = tmpFile();
    fs.writeFileSync(filePath, "{not json", "utf8");

    expect(createTimingHistory({ filePath }).list()).toEqual([]);
  });

  it("starts empty when the file holds something other than a list", () => {
    const filePath = tmpFile();
    fs.writeFileSync(filePath, JSON.stringify({ at: 1 }), "utf8");

    expect(createTimingHistory({ filePath }).list()).toEqual([]);
  });

  it("keeps working when the file cannot be written", () => {
    // The parent directory does not exist, so every write fails.
    const filePath = path.join(os.tmpdir(), "voicetyper-missing-dir-xyz", "timings.json");
    const history = createTimingHistory({ filePath });

    expect(() => history.add(entry(1))).not.toThrow();
    expect(history.list().map((e) => e.at)).toEqual([1]);
  });

  it("marks a model that never answered before the restart as unfinished", () => {
    const filePath = tmpFile();
    createTimingHistory({ filePath }).add(
      entry(1, { models: [{ label: "Google", ms: null, status: "pending" }, { label: "Mistral", ms: 900, status: "ok" }] })
    );

    const models = createTimingHistory({ filePath }).list()[0].models;

    expect(models.map((m) => m.status)).toEqual(["unfinished", "ok"]);
  });
});
