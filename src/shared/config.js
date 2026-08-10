const fs = require("fs");

const { KEY_NAMES } = require("./keys.js");

const DEFAULT_SUMMARY_PROMPT =
  "Summarise the transcript below in the same language it is written in. " +
  "Be concise: one to three sentences, no preamble, no bullet points. " +
  "Output only the summary text.";

const DEFAULTS = {
  recordKey: "RIGHT ALT",
  // "" disables the summary command. Pairs with the right-side AltGr record
  // key default: hold AltGr, add Right Shift for transcript + summary.
  summaryModifier: "RIGHT SHIFT",
  language: "auto",
  model: "voxtral-mini-latest",
  summaryModel: "mistral-small-latest",
  summaryPrompt: DEFAULT_SUMMARY_PROMPT,
  separator: "blank-line",
  sampleRate: 16000,
  micDeviceId: null,
  autoLaunch: false,
};

const LANGUAGES = ["auto", "de", "en"];

const SEPARATORS = ["blank-line", "dash", "spaces"];

// Returns a message fit for the Settings window, or null when the modifier is
// usable. An empty string is a deliberate opt-out, not an error. The main
// process is the only place this rule lives; the renderer surfaces the
// message returned by settings:save rather than re-implementing the check.
function summaryModifierError(recordKey, summaryModifier) {
  if (summaryModifier === "") return null;
  const mod = typeof summaryModifier === "string" ? summaryModifier.toUpperCase() : summaryModifier;
  if (!KEY_NAMES.includes(mod)) return `“${mod}” is not a bindable key.`;
  const record = typeof recordKey === "string" ? recordKey.toUpperCase() : recordKey;
  if (mod === record) return "The summary modifier must differ from the record key.";
  return null;
}

function mergeConfig(overrides) {
  const out = { ...DEFAULTS };
  if (overrides && typeof overrides === "object") {
    for (const key of Object.keys(DEFAULTS)) {
      if (key in overrides) out[key] = overrides[key];
    }
  }
  return validateConfig(out);
}

function nonEmptyString(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function validateConfig(config) {
  const c = { ...config };
  if (!LANGUAGES.includes(c.language)) c.language = DEFAULTS.language;
  if (!Number.isInteger(c.sampleRate) || c.sampleRate <= 0) {
    c.sampleRate = DEFAULTS.sampleRate;
  }
  if (!KEY_NAMES.includes(c.recordKey)) c.recordKey = DEFAULTS.recordKey;
  // An invalid modifier is disabled rather than replaced by the default
  // modifier: a substituted default could itself collide with a custom
  // record key.
  c.summaryModifier = summaryModifierError(c.recordKey, c.summaryModifier)
    ? ""
    : c.summaryModifier.toUpperCase();
  c.summaryModel = nonEmptyString(c.summaryModel, DEFAULTS.summaryModel);
  // Not trimmed: a custom prompt may end in a meaningful newline.
  c.summaryPrompt =
    typeof c.summaryPrompt === "string" && c.summaryPrompt.trim().length > 0
      ? c.summaryPrompt
      : DEFAULTS.summaryPrompt;
  if (!SEPARATORS.includes(c.separator)) c.separator = DEFAULTS.separator;
  c.autoLaunch = Boolean(c.autoLaunch);
  return c;
}

function loadConfig(filePath) {
  let overrides = {};
  try {
    if (fs.existsSync(filePath)) {
      overrides = JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch {
    overrides = {};
  }
  return mergeConfig(overrides);
}

function saveConfig(filePath, config) {
  fs.writeFileSync(filePath, JSON.stringify(validateConfig(config), null, 2), "utf8");
}

module.exports = {
  DEFAULTS,
  LANGUAGES,
  SEPARATORS,
  DEFAULT_SUMMARY_PROMPT,
  summaryModifierError,
  mergeConfig,
  validateConfig,
  loadConfig,
  saveConfig,
};
