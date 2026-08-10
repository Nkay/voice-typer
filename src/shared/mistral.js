const API_BASE = "https://api.mistral.ai/v1";

class MistralError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MistralError";
    this.code = code;
  }
}

function errorForStatus(status) {
  if (status === 401) return new MistralError("UNAUTHORIZED", "Invalid Mistral API key");
  if (status === 429) return new MistralError("RATE_LIMIT", "Rate limited");
  return new MistralError("HTTP", `HTTP ${status}`);
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

module.exports = { API_BASE, MistralError, errorForStatus, fetchWithTimeout };
