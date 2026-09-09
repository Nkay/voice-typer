const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

class GoogleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GoogleError";
    this.code = code;
  }
}

// `body` is the parsed error payload when the caller has it. Google reports a
// bad API key as 400/INVALID_ARGUMENT rather than 401, so the reason inside the
// body is the only way to tell "your key is wrong" from "your request is wrong".
function errorForStatus(status, body) {
  if (status === 401 || status === 403) return new GoogleError("UNAUTHORIZED", "Invalid Google API key");
  if (status === 429) return new GoogleError("RATE_LIMIT", "Rate limited");
  if (status === 400 && isInvalidApiKey(body)) {
    return new GoogleError("UNAUTHORIZED", "Invalid Google API key");
  }
  return new GoogleError("HTTP", `HTTP ${status}`);
}

// The two API surfaces disagree on error shape: /models answers with a bare
// {error}, /interactions with a [{error}] array. Both are handled rather than
// picking one, since either surface may be the first to reject a bad key.
function isInvalidApiKey(body) {
  const entries = Array.isArray(body) ? body : [body];
  return entries.some((entry) => {
    const error = entry && entry.error;
    if (!error) return false;
    const details = Array.isArray(error.details) ? error.details : [];
    if (details.some((d) => d && d.reason === "API_KEY_INVALID")) return true;
    return typeof error.message === "string" && /API key not valid/i.test(error.message);
  });
}

async function fetchWithTimeout(url, options = {}, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { GEMINI_API_BASE, GoogleError, errorForStatus, fetchWithTimeout };
