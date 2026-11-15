import { describe, it, expect } from "vitest";
import {
  MAX_HINTS,
  TEMPLATE,
  parseDictionary,
  applyDictionary,
  liveCut,
  createDictionaryStore,
  describeDictionaryFile,
} from "../src/shared/dictionary.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("parseDictionary", () => {
  it("reads terms and corrections and skips comments and blank lines", () => {
    const dict = parseDictionary("﻿# comment\r\n\r\nchax\r\nTschax, Chacks => chax\nWebStorm\n  Voice   Typer  => VoiceTyper\n");
    expect(dict.terms).toEqual(["chax", "WebStorm", "VoiceTyper"]);
    expect(dict.hints).toEqual(dict.terms);
    expect(dict.replacements.map((r) => [r.from, r.to])).toEqual(
      expect.arrayContaining([
        ["Tschax", "chax"],
        ["Chacks", "chax"],
        ["Voice Typer", "VoiceTyper"],
        ["chax", "chax"],
      ])
    );
    expect(dict.maxWords).toBe(2);
  });

  it("ignores a correction without a right side and keeps the first of duplicate terms", () => {
    const dict = parseDictionary("foo =>\nchax\nCHAX\n");
    expect(dict.terms).toEqual(["chax"]);
  });

  it("gives at most MAX_HINTS terms as hints", () => {
    const text = Array.from({ length: MAX_HINTS + 5 }, (_, i) => `term${i}`).join("\n");
    const dict = parseDictionary(text);
    expect(dict.terms).toHaveLength(MAX_HINTS + 5);
    expect(dict.hints).toHaveLength(MAX_HINTS);
  });

  it("has only comments in the template", () => {
    expect(parseDictionary(TEMPLATE).terms).toEqual([]);
  });
});

describe("applyDictionary", () => {
  const dict = parseDictionary("chax\nTschax, Chacks => chax\nVoice Typer => VoiceTyper\nC++ => C++\nÄrzteamt\n");

  it("corrects wrong forms and the case of terms, for whole words only", () => {
    expect(applyDictionary("Ich arbeite bei Tschax und CHAX.", dict)).toBe("Ich arbeite bei chax und chax.");
    expect(applyDictionary("chaxing Chacksville", dict)).toBe("chaxing Chacksville");
  });

  it("lets a correction win over the case fix of a term with the same spelling", () => {
    const own = parseDictionary("Mistral\nmistral => Mistral AI\n");
    expect(applyDictionary("I use mistral", own)).toBe("I use Mistral AI");
  });

  it("matches a phrase across any whitespace and does not replace a replacement again", () => {
    expect(applyDictionary("the voice\n typer app", dict)).toBe("the VoiceTyper app");
  });

  it("handles regex characters and non-ASCII letters", () => {
    expect(applyDictionary("I like c++ code", dict)).toBe("I like C++ code");
    expect(applyDictionary("das ärzteamt und Ärzteamtes", dict)).toBe("das Ärzteamt und Ärzteamtes");
  });

  it("returns the text unchanged without a dictionary", () => {
    expect(applyDictionary("Tschax", parseDictionary(""))).toBe("Tschax");
    expect(applyDictionary("", dict)).toBe("");
  });
});

describe("liveCut", () => {
  it("holds back the last word, which can be incomplete", () => {
    const dict = parseDictionary("chax");
    expect(liveCut("one two thr", dict)).toBe(8);
    expect(liveCut("one two ", dict)).toBe(4);
    expect(liveCut("one", dict)).toBe(0);
    expect(liveCut(" one", dict)).toBe(1);
  });

  it("holds back as many words as the longest phrase and never cuts through a match", () => {
    const dict = parseDictionary("Voice Typer => VoiceTyper");
    expect(liveCut("one two thr", dict)).toBe(4);
    expect(liveCut("open voice typer now ", dict)).toBe(5);
  });

  it("holds back nothing without corrections", () => {
    expect(liveCut("one two", parseDictionary(""))).toBe(7);
  });
});

function fakeFs(files) {
  const calls = { stat: 0, readFile: 0 };
  return {
    calls,
    files,
    async stat(p) {
      calls.stat++;
      if (!(p in files)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { mtimeMs: files[p].mtime, size: files[p].text.length };
    },
    async readFile(p) {
      calls.readFile++;
      if (!(p in files)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return files[p].text;
    },
  };
}

describe("createDictionaryStore", () => {
  it("gives the empty dictionary when no file is set", async () => {
    const store = createDictionaryStore({ getPath: () => "", fsp: fakeFs({}) });
    expect((await store.load()).terms).toEqual([]);
  });

  it("reads the file once and again only after it changed", async () => {
    const fsp = fakeFs({ "d.txt": { mtime: 1, text: "chax" } });
    const store = createDictionaryStore({ getPath: () => "d.txt", fsp });
    expect((await store.load()).terms).toEqual(["chax"]);
    await store.load();
    expect(fsp.calls.readFile).toBe(1);
    fsp.files["d.txt"] = { mtime: 2, text: "chax\nWebStorm" };
    expect((await store.load()).terms).toEqual(["chax", "WebStorm"]);
    expect(store.current().terms).toEqual(["chax", "WebStorm"]);
    expect(fsp.calls.readFile).toBe(2);
  });

  it("keeps the last good copy when the file cannot be read and reports each new error once", async () => {
    const fsp = fakeFs({ "d.txt": { mtime: 1, text: "chax" } });
    const errors = [];
    const store = createDictionaryStore({ getPath: () => "d.txt", fsp, onError: (m) => errors.push(m) });
    await store.load();
    delete fsp.files["d.txt"];
    expect((await store.load()).terms).toEqual(["chax"]);
    expect((await store.load()).terms).toEqual(["chax"]);
    expect(errors).toEqual(["Dictionary file not found"]);
  });

  it("reports the error again when it comes back after the unchanged file was readable", async () => {
    const fsp = fakeFs({ "d.txt": { mtime: 1, text: "chax" } });
    const errors = [];
    const store = createDictionaryStore({ getPath: () => "d.txt", fsp, onError: (m) => errors.push(m) });
    const file = fsp.files["d.txt"];
    await store.load();
    delete fsp.files["d.txt"];
    await store.load();
    fsp.files["d.txt"] = file;
    await store.load();
    delete fsp.files["d.txt"];
    await store.load();
    expect(errors).toEqual(["Dictionary file not found", "Dictionary file not found"]);
  });

  it("does not wait longer than the timeout for a slow file", async () => {
    let release;
    const fsp = {
      stat: () => new Promise((r) => (release = () => r({ mtimeMs: 1, size: 4 }))),
      readFile: async () => "chax",
    };
    let fire;
    const timers = { setTimeout: (fn) => ((fire = fn), 1), clearTimeout: () => {} };
    const store = createDictionaryStore({ getPath: () => "d.txt", fsp, timers });
    const pending = store.load();
    fire();
    expect((await pending).terms).toEqual([]);
    release();
    await flush();
    expect(store.current().terms).toEqual(["chax"]);
  });

  it("forgets the dictionary of a path that is no longer set", async () => {
    let filePath = "d.txt";
    const store = createDictionaryStore({
      getPath: () => filePath,
      fsp: fakeFs({ "d.txt": { mtime: 1, text: "chax" } }),
    });
    await store.load();
    filePath = "";
    expect(store.current().terms).toEqual([]);
    expect((await store.load()).terms).toEqual([]);
  });
});

describe("describeDictionaryFile", () => {
  it("counts terms and real corrections", async () => {
    const fsp = fakeFs({ "d.txt": { mtime: 1, text: "chax\nTschax => chax\nWebStorm" } });
    expect(await describeDictionaryFile("d.txt", fsp)).toEqual({ ok: true, terms: 2, corrections: 1 });
  });

  it("reports a missing file", async () => {
    expect(await describeDictionaryFile("x.txt", fakeFs({}))).toEqual({ ok: false, error: "File not found" });
  });
});
