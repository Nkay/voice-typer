const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

class GoogleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GoogleError";
    this.code = code;
  }
}

function errorForStatus(status) {
  if (status === 401 || status === 403) return new GoogleError("UNAUTHORIZED", "Invalid Google API key");
  if (status === 429) return new GoogleError("RATE_LIMIT", "Rate limited");
  return new GoogleError("HTTP", `HTTP ${status}`);
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
