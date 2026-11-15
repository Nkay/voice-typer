const fs = require("fs");

// The models get at most this many terms as hints. Google accepts up to 1,000
// but documents the best results at about 100; the other providers state no
// safe limit, so one cap serves all of them.
const MAX_HINTS = 100;

const EMPTY = Object.freeze({ terms: [], hints: [], replacements: [], maxWords: 1 });

const TEMPLATE = [
  "# VoiceTyper dictionary",
  "# One word or name per line. VoiceTyper gives these words to the",
  "# transcription models as hints and corrects their spelling and case.",
  "#",
  "# To correct a frequent wrong transcript, write:  wrong => right",
  "# For several wrong forms, separate them with commas:  wrong one, wrong two => right",
  "# Lines that start with # are comments.",
  "#",
  "# Examples:",
  "# VoiceTyper",
  "# Voice Typer, Voicetyper => VoiceTyper",
  "",
].join("\r\n");

const WORD_CHAR = "[\\p{L}\\p{N}]";

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whitespace in a phrase matches any run of whitespace in the transcript.
function phrasePattern(phrase) {
  return phrase.split(/\s+/).map(escapeRegExp).join("\\s+");
}

function wordCount(phrase) {
  return phrase.split(/\s+/).length;
}

// Each line is a term ("chax") or a correction ("Tschax, Chacks => chax").
// A term also corrects its own case, so "Chax" becomes "chax".
function parseDictionary(text) {
  const terms = [];
  const seenTerms = new Set();
  const pairs = new Map();

  const addTerm = (term) => {
    const key = term.toLowerCase();
    if (seenTerms.has(key)) return;
    seenTerms.add(key);
    terms.push(term);
  };
  const addPair = (from, to) => {
    const key = from.replace(/\s+/g, " ").toLowerCase();
    if (!pairs.has(key)) pairs.set(key, { from, to });
  };
  const clean = (part) => part.trim().replace(/\s+/g, " ");

  for (const raw of String(text || "").replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const arrow = line.indexOf("=>");
    if (arrow === -1) {
      const term = clean(line);
      addTerm(term);
      addPair(term, term);
      continue;
    }
    const to = clean(line.slice(arrow + 2));
    if (to.length === 0) continue;
    addTerm(to);
    addPair(to, to);
    for (const from of line.slice(0, arrow).split(",").map(clean)) {
      if (from.length > 0) addPair(from, to);
    }
  }

  // Longest first, so "Voice Typer" wins over "Voice".
  const replacements = [...pairs.values()]
    .sort((a, b) => b.from.length - a.from.length)
    .map(({ from, to }) => ({
      from,
      to,
      pattern: phrasePattern(from),
      exact: new RegExp(`^(?:${phrasePattern(from)})$`, "iu"),
    }));
  const maxWords = replacements.reduce((max, r) => Math.max(max, wordCount(r.from)), 1);
  return { terms, hints: terms.slice(0, MAX_HINTS), replacements, maxWords };
}

function combinedPattern(dict) {
  if (!dict.combined) {
    const alternatives = dict.replacements.map((r) => r.pattern).join("|");
    dict.combined = new RegExp(`(?<!${WORD_CHAR})(?:${alternatives})(?!${WORD_CHAR})`, "giu");
  }
  return dict.combined;
}

// Replaces whole words and phrases only, without regard to case: "chaxing" stays.
// One pass, so a replacement is never replaced again.
function applyDictionary(text, dict) {
  if (!text || !dict || dict.replacements.length === 0) return text;
  return text.replace(combinedPattern(dict), (match) => {
    const entry = dict.replacements.find((r) => r.exact.test(match));
    return entry ? entry.to : match;
  });
}

// Live text arrives in pieces. Returns how much of `text` can be corrected and
// typed now: not the last `dict.maxWords` words, because the next piece can
// complete them, and not a match that runs into those words. 0 means none.
function liveCut(text, dict) {
  if (!dict || dict.replacements.length === 0) return text.length;
  let cut = text.length;
  for (let i = 0; i < dict.maxWords; i++) {
    const head = text.slice(0, cut).replace(/\s+$/, "");
    const lastSpace = head.search(/\s\S*$/);
    if (lastSpace === -1) return 0;
    cut = lastSpace + 1;
  }
  for (const match of text.matchAll(combinedPattern(dict))) {
    if (match.index < cut && match.index + match[0].length > cut) return match.index;
  }
  return cut;
}

// Reads the dictionary file on demand and keeps the last good copy. The file is
// usually in a OneDrive folder, so a read can wait for a download or fail while
// offline; load() then gives the last good copy and never rejects.
function createDictionaryStore({
  getPath,
  fsp = fs.promises,
  timeoutMs = 2000,
  onError = () => {},
  timers = { setTimeout, clearTimeout },
} = {}) {
  let cache = { path: "", stamp: null, dict: EMPTY };
  let inFlight = null;
  let lastErrorMessage = null;

  const currentPath = () => {
    const p = getPath();
    return typeof p === "string" ? p.trim() : "";
  };

  async function read(filePath) {
    try {
      const stat = await fsp.stat(filePath);
      const stamp = `${stat.mtimeMs}:${stat.size}`;
      if (cache.path === filePath && cache.stamp === stamp) return cache.dict;
      const dict = parseDictionary(await fsp.readFile(filePath, "utf8"));
      cache = { path: filePath, stamp, dict };
      lastErrorMessage = null;
      return dict;
    } catch (err) {
      const message = err && err.code === "ENOENT" ? "Dictionary file not found" : "Could not read the dictionary file";
      console.error(`VoiceTyper: ${message}: ${filePath}`, err);
      if (message !== lastErrorMessage) {
        lastErrorMessage = message;
        onError(message);
      }
      return cache.path === filePath ? cache.dict : EMPTY;
    }
  }

  function current() {
    const filePath = currentPath();
    return filePath && cache.path === filePath ? cache.dict : EMPTY;
  }

  function load() {
    const filePath = currentPath();
    if (!filePath) return Promise.resolve(EMPTY);
    if (!inFlight || inFlight.path !== filePath) {
      const entry = { path: filePath, promise: null };
      entry.promise = read(filePath).finally(() => {
        if (inFlight === entry) inFlight = null;
      });
      inFlight = entry;
    }
    let timer;
    const timeout = new Promise((resolve) => {
      timer = timers.setTimeout(() => resolve(current()), timeoutMs);
    });
    return Promise.race([inFlight.promise, timeout]).finally(() => timers.clearTimeout(timer));
  }

  return { load, current };
}

// Summary for the Settings window. Never throws.
async function describeDictionaryFile(filePath, fsp = fs.promises) {
  if (!filePath) return { ok: true, terms: 0, corrections: 0 };
  try {
    const dict = parseDictionary(await fsp.readFile(filePath, "utf8"));
    const corrections = dict.replacements.filter((r) => r.from.toLowerCase() !== r.to.toLowerCase()).length;
    return { ok: true, terms: dict.terms.length, corrections };
  } catch (err) {
    return { ok: false, error: err && err.code === "ENOENT" ? "File not found" : "Could not read the file" };
  }
}

module.exports = {
  MAX_HINTS,
  EMPTY,
  TEMPLATE,
  parseDictionary,
  applyDictionary,
  liveCut,
  createDictionaryStore,
  describeDictionaryFile,
};
