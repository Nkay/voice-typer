import { describe, it, expect } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import * as cfg from "../src/shared/config.js";
import { KEY_NAMES } from "../src/shared/keys.js";

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

  it("falls back to the default recordKey for a key outside the catalog", () => {
    const c = cfg.validateConfig({ ...cfg.DEFAULTS, recordKey: "ESCAPE" });
    expect(c.recordKey).toBe("RIGHT ALT");
  });

  it("accepts every catalog key as the recordKey", () => {
    for (const key of KEY_NAMES) {
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

  it("defaults the summary settings", () => {
    const c = cfg.mergeConfig({});
    expect(c.summaryKeys).toEqual(["LEFT CTRL", "LEFT SHIFT"]);
    expect(c.summaryModel).toBe("mistral-small-latest");
    expect(c.summaryPrompt).toBe(cfg.DEFAULT_SUMMARY_PROMPT);
    expect(c.separator).toBe("blank-line");
  });

  it("keeps a valid two-key chord", () => {
    const c = cfg.validateConfig({ ...cfg.DEFAULTS, summaryKeys: ["F13", "F14"] });
    expect(c.summaryKeys).toEqual(["F13", "F14"]);
  });

  it("upper-cases chord key names", () => {
    const c = cfg.validateConfig({ ...cfg.DEFAULTS, summaryKeys: ["left ctrl", "left shift"] });
    expect(c.summaryKeys).toEqual(["LEFT CTRL", "LEFT SHIFT"]);
  });

  it("disables the chord when it collides with the record key", () => {
    const c = cfg.validateConfig({
      ...cfg.DEFAULTS,
      recordKey: "LEFT CTRL",
      summaryKeys: ["LEFT CTRL", "LEFT SHIFT"],
    });
    expect(c.summaryKeys).toEqual([]);
    expect(c.recordKey).toBe("LEFT CTRL");
  });

  it("disables the chord when both keys are the same", () => {
    const c = cfg.validateConfig({ ...cfg.DEFAULTS, summaryKeys: ["F13", "F13"] });
    expect(c.summaryKeys).toEqual([]);
  });

  it("disables the chord for a wrong-length or non-array value", () => {
    expect(cfg.validateConfig({ ...cfg.DEFAULTS, summaryKeys: ["F13"] }).summaryKeys).toEqual([]);
    expect(
      cfg.validateConfig({ ...cfg.DEFAULTS, summaryKeys: ["F13", "F14", "F15"] }).summaryKeys
    ).toEqual([]);
    expect(cfg.validateConfig({ ...cfg.DEFAULTS, summaryKeys: "F13" }).summaryKeys).toEqual([]);
    expect(cfg.validateConfig({ ...cfg.DEFAULTS, summaryKeys: null }).summaryKeys).toEqual([]);
  });

  it("disables the chord when a key is not in the catalog", () => {
    const c = cfg.validateConfig({ ...cfg.DEFAULTS, summaryKeys: ["LEFT CTRL", "ESCAPE"] });
    expect(c.summaryKeys).toEqual([]);
  });

  it("falls back to the default summaryModel for an empty or non-string value", () => {
    expect(cfg.validateConfig({ ...cfg.DEFAULTS, summaryModel: "  " }).summaryModel).toBe(
      "mistral-small-latest"
    );
    expect(cfg.validateConfig({ ...cfg.DEFAULTS, summaryModel: 7 }).summaryModel).toBe(
      "mistral-small-latest"
    );
  });

  it("trims and keeps a custom summaryModel", () => {
    const c = cfg.validateConfig({ ...cfg.DEFAULTS, summaryModel: "  mistral-large-latest  " });
    expect(c.summaryModel).toBe("mistral-large-latest");
  });

  it("falls back to the default summaryPrompt for an empty value", () => {
    const c = cfg.validateConfig({ ...cfg.DEFAULTS, summaryPrompt: "   " });
    expect(c.summaryPrompt).toBe(cfg.DEFAULT_SUMMARY_PROMPT);
  });

  it("keeps a custom summaryPrompt verbatim, including newlines", () => {
    const prompt = "Summarise in one line.\n\nExample:\nin -> out";
    const c = cfg.validateConfig({ ...cfg.DEFAULTS, summaryPrompt: prompt });
    expect(c.summaryPrompt).toBe(prompt);
  });

  it("falls back to the default separator for an unknown value", () => {
    const c = cfg.validateConfig({ ...cfg.DEFAULTS, separator: "pipe" });
    expect(c.separator).toBe("blank-line");
  });

  it("accepts every separator", () => {
    for (const sep of cfg.SEPARATORS) {
      expect(cfg.validateConfig({ ...cfg.DEFAULTS, separator: sep }).separator).toBe(sep);
    }
  });

  it("round-trips the summary settings through save and load", () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vt-")), "config.json");
    cfg.saveConfig(
      p,
      cfg.mergeConfig({ summaryKeys: ["F13", "F14"], separator: "dash", summaryPrompt: "Short." })
    );
    const c = cfg.loadConfig(p);
    expect(c.summaryKeys).toEqual(["F13", "F14"]);
    expect(c.separator).toBe("dash");
    expect(c.summaryPrompt).toBe("Short.");
  });
});

describe("summaryKeysError", () => {
  it("accepts a valid chord", () => {
    expect(cfg.summaryKeysError("RIGHT ALT", ["LEFT CTRL", "LEFT SHIFT"])).toBeNull();
  });

  it("accepts an empty chord as a deliberate opt-out", () => {
    expect(cfg.summaryKeysError("RIGHT ALT", [])).toBeNull();
  });

  it("rejects two identical keys", () => {
    expect(cfg.summaryKeysError("RIGHT ALT", ["F13", "F13"])).toMatch(/different/i);
  });

  it("rejects a chord containing the record key", () => {
    expect(cfg.summaryKeysError("LEFT CTRL", ["LEFT CTRL", "LEFT SHIFT"])).toMatch(/record key/i);
  });

  it("rejects a half-filled chord", () => {
    expect(cfg.summaryKeysError("RIGHT ALT", ["LEFT CTRL"])).toMatch(/two keys/i);
  });

  it("rejects an unknown key name", () => {
    expect(cfg.summaryKeysError("RIGHT ALT", ["LEFT CTRL", "ESCAPE"])).toMatch(/not a bindable key/i);
  });
});
