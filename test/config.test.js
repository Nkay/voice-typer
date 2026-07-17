import { describe, it, expect } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import * as cfg from "../src/shared/config.js";

describe("config", () => {
  it("returns defaults when file is missing", () => {
    const c = cfg.loadConfig(path.join(os.tmpdir(), "vt-missing-xyz.json"));
    expect(c.recordKey).toBe("RIGHT ALT");
    expect(c.language).toBe("auto");
    expect(c.model).toBe("voxtral-mini-latest");
    expect(c.sampleRate).toBe(16000);
    expect(c.autoLaunch).toBe(false);
  });

  it("merges overrides and keeps unknown keys out", () => {
    const c = cfg.mergeConfig({ language: "de", bogus: 1 });
    expect(c.language).toBe("de");
    expect("bogus" in c).toBe(false);
    expect(c.recordKey).toBe("RIGHT ALT");
  });

  it("falls back to auto for an invalid language", () => {
    const c = cfg.validateConfig({ ...cfg.DEFAULTS, language: "xx" });
    expect(c.language).toBe("auto");
  });

  it("falls back to the default recordKey for a value outside RECORD_KEYS", () => {
    const c = cfg.validateConfig({ ...cfg.DEFAULTS, recordKey: "F13" });
    expect(c.recordKey).toBe("RIGHT ALT");
  });

  it("accepts every whitelisted recordKey", () => {
    for (const key of cfg.RECORD_KEYS) {
      const c = cfg.validateConfig({ ...cfg.DEFAULTS, recordKey: key });
      expect(c.recordKey).toBe(key);
    }
  });

  it("falls back to default sampleRate for a bad value", () => {
    const c = cfg.validateConfig({ ...cfg.DEFAULTS, sampleRate: 0 });
    expect(c.sampleRate).toBe(16000);
  });

  it("round-trips through save and load", () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vt-")), "config.json");
    cfg.saveConfig(p, cfg.mergeConfig({ language: "en" }));
    const c = cfg.loadConfig(p);
    expect(c.language).toBe("en");
  });
});
