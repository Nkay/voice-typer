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
    expect(c.summaryModifier).toBe("RIGHT SHIFT");
    expect(c.summaryModel).toBe("mistral-small-latest");
    expect(c.summaryPrompt).toBe(cfg.DEFAULT_SUMMARY_PROMPT);
    expect(c.separator).toBe("blank-line");
  });

  it("does not expose summaryKeys anymore", () => {
    const c = cfg.mergeConfig({});
    expect("summaryKeys" in c).toBe(false);
    expect("summaryKeys" in cfg.DEFAULTS).toBe(false);
  });

  it("keeps a valid summaryModifier", () => {
    const c = cfg.validateConfig({ ...cfg.DEFAULTS, summaryModifier: "F13" });
    expect(c.summaryModifier).toBe("F13");
  });

  it("upper-cases the summaryModifier", () => {
    const c = cfg.validateConfig({ ...cfg.DEFAULTS, summaryModifier: "left shift" });
    expect(c.summaryModifier).toBe("LEFT SHIFT");
  });

  it("keeps an empty summaryModifier as a deliberate opt-out", () => {
    const c = cfg.validateConfig({ ...cfg.DEFAULTS, summaryModifier: "" });
    expect(c.summaryModifier).toBe("");
  });

  it("disables the modifier, rather than substituting the default, when it collides with the record key", () => {
    const c = cfg.validateConfig({
      ...cfg.DEFAULTS,
      recordKey: "RIGHT SHIFT",
      summaryModifier: "RIGHT SHIFT",
    });
    expect(c.summaryModifier).toBe("");
    expect(c.recordKey).toBe("RIGHT SHIFT");
  });

  it("disables the modifier when it is not in the catalog", () => {
    const c = cfg.validateConfig({ ...cfg.DEFAULTS, summaryModifier: "ESCAPE" });
    expect(c.summaryModifier).toBe("");
  });

  it("disables the modifier for a non-string value", () => {
    expect(cfg.validateConfig({ ...cfg.DEFAULTS, summaryModifier: null }).summaryModifier).toBe(
      ""
    );
    expect(
      cfg.validateConfig({ ...cfg.DEFAULTS, summaryModifier: undefined }).summaryModifier
    ).toBe("");
    expect(cfg.validateConfig({ ...cfg.DEFAULTS, summaryModifier: 7 }).summaryModifier).toBe("");
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
      cfg.mergeConfig({ summaryModifier: "F13", separator: "dash", summaryPrompt: "Short." })
    );
    const c = cfg.loadConfig(p);
    expect(c.summaryModifier).toBe("F13");
    expect(c.separator).toBe("dash");
    expect(c.summaryPrompt).toBe("Short.");
  });

  it("drops a legacy summaryKeys field and defaults summaryModifier when loading an old config.json", () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vt-")), "config.json");
    fs.writeFileSync(
      p,
      JSON.stringify({ recordKey: "RIGHT ALT", summaryKeys: ["LEFT CTRL", "LEFT SHIFT"] }),
      "utf8"
    );
    const c = cfg.loadConfig(p);
    expect("summaryKeys" in c).toBe(false);
    expect(c.summaryModifier).toBe("RIGHT SHIFT");
    expect(c.recordKey).toBe("RIGHT ALT");
  });

  it("defaults transcriptionProvider to mistral", () => {
    const c = cfg.mergeConfig({});
    expect(c.transcriptionProvider).toBe("mistral");
  });

  it("accepts valid transcription providers", () => {
    for (const p of ["mistral", "google", "both"]) {
      expect(cfg.validateConfig({ ...cfg.DEFAULTS, transcriptionProvider: p }).transcriptionProvider).toBe(p);
    }
  });

  it("falls back to mistral for an invalid provider", () => {
    expect(
      cfg.validateConfig({ ...cfg.DEFAULTS, transcriptionProvider: "openai" }).transcriptionProvider
    ).toBe("mistral");
  });

  it("falls back to mistral for a non-string provider", () => {
    expect(
      cfg.validateConfig({ ...cfg.DEFAULTS, transcriptionProvider: null }).transcriptionProvider
    ).toBe("mistral");
  });

  it("round-trips transcriptionProvider through save and load", () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vt-")), "config.json");
    cfg.saveConfig(p, cfg.mergeConfig({ transcriptionProvider: "both" }));
    const c = cfg.loadConfig(p);
    expect(c.transcriptionProvider).toBe("both");
  });
});

describe("summaryModifierError", () => {
  it("accepts a valid modifier", () => {
    expect(cfg.summaryModifierError("RIGHT ALT", "RIGHT SHIFT")).toBeNull();
  });

  it("accepts an empty string as a deliberate opt-out", () => {
    expect(cfg.summaryModifierError("RIGHT ALT", "")).toBeNull();
  });

  it("rejects a modifier equal to the record key", () => {
    expect(cfg.summaryModifierError("LEFT CTRL", "LEFT CTRL")).toMatch(/record key/i);
  });

  it("rejects an unknown key name", () => {
    expect(cfg.summaryModifierError("RIGHT ALT", "ESCAPE")).toMatch(/not a bindable key/i);
  });

  it("rejects a non-string, non-empty value", () => {
    expect(cfg.summaryModifierError("RIGHT ALT", null)).toMatch(/not a bindable key/i);
  });
});
