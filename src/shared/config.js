const fs = require("fs");

const { KEY_NAMES } = require("./keys.js");
const { normalizeEndpoint } = require("./microsoft.js");

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
  // Every checked model is asked at the same time; the first transcript wins.
  transcriptionModels: ["mistral"],
  // Foundry resource root, e.g. "https://my-resource.services.ai.azure.com".
  // Not a secret; the key lives in secrets like the other providers' keys.
  microsoftEndpoint: "",
  microsoftDeployment: "MAI-Transcribe-2-Streaming",
};

const LANGUAGES = ["auto", "de", "en"];

const SEPARATORS = ["blank-line", "dash", "spaces"];

// Microsoft alone types live while the key is held.
const TRANSCRIPTION_MODELS = ["mistral", "google", "microsoft"];

// The old single-choice "transcriptionProvider" setting, read once from an
// older config file.
const LEGACY_PROVIDERS = {
  mistral: ["mistral"],
  google: ["google"],
  microsoft: ["microsoft"],
  both: ["mistral", "google"],
  all: ["mistral", "google", "microsoft"],
};

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
    if (!("transcriptionModels" in overrides) && Object.hasOwn(LEGACY_PROVIDERS, overrides.transcriptionProvider)) {
      out.transcriptionModels = LEGACY_PROVIDERS[overrides.transcriptionProvider];
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
  const models = Array.isArray(c.transcriptionModels) ? c.transcriptionModels : [];
  c.transcriptionModels = TRANSCRIPTION_MODELS.filter((m) => models.includes(m));
  if (c.transcriptionModels.length === 0) c.transcriptionModels = [...DEFAULTS.transcriptionModels];
  c.microsoftEndpoint = normalizeEndpoint(c.microsoftEndpoint);
  c.microsoftDeployment = nonEmptyString(c.microsoftDeployment, DEFAULTS.microsoftDeployment);
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
