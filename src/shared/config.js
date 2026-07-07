const fs = require("fs");

const DEFAULTS = {
  recordKey: "RIGHT ALT",
  language: "auto",
  model: "voxtral-mini-latest",
  sampleRate: 16000,
  micDeviceId: null,
  autoLaunch: false,
};

const LANGUAGES = ["auto", "de", "en"];

function mergeConfig(overrides) {
  const out = { ...DEFAULTS };
  if (overrides && typeof overrides === "object") {
    for (const key of Object.keys(DEFAULTS)) {
      if (key in overrides) out[key] = overrides[key];
    }
  }
  return validateConfig(out);
}

function validateConfig(config) {
  const c = { ...config };
  if (!LANGUAGES.includes(c.language)) c.language = DEFAULTS.language;
  if (!Number.isInteger(c.sampleRate) || c.sampleRate <= 0) {
    c.sampleRate = DEFAULTS.sampleRate;
  }
  if (typeof c.recordKey !== "string" || c.recordKey.trim() === "") {
    c.recordKey = DEFAULTS.recordKey;
  }
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

module.exports = { DEFAULTS, LANGUAGES, mergeConfig, validateConfig, loadConfig, saveConfig };
