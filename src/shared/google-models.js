const { GEMINI_API_BASE, GoogleError, errorForStatus, fetchWithTimeout } = require("./google.js");

const MODELS_ENDPOINT = `${GEMINI_API_BASE}/models`;

async function fetchGeminiModels({ apiKey, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!apiKey) throw new GoogleError("NO_API_KEY", "No Google API key configured");

  let res;
  try {
    res = await fetchWithTimeout(
      `${MODELS_ENDPOINT}?key=${apiKey}`,
      { method: "GET" },
      { fetchImpl, timeoutMs }
    );
  } catch (err) {
    throw new GoogleError("NETWORK", `Network error: ${err.message}`);
  }

  if (!res.ok) throw errorForStatus(res.status, await res.json().catch(() => null));

  let data;
  try {
    data = await res.json();
  } catch {
    throw new GoogleError("BAD_RESPONSE", "Malformed response from models API");
  }

  if (!data || !Array.isArray(data.models)) {
    throw new GoogleError("BAD_RESPONSE", "Unexpected shape from models API");
  }

  const ids = new Set();
  for (const model of data.models) {
    if (!model || typeof model.name !== "string") continue;
    if (!Array.isArray(model.supportedGenerationMethods)) continue;
    if (!model.supportedGenerationMethods.includes("generateContent")) continue;
    // Strip "models/" prefix: "models/gemini-3.7-flash" → "gemini-3.7-flash"
    ids.add(model.name.replace(/^models\//, ""));
  }
  return [...ids].sort();
}

module.exports = { fetchGeminiModels, MODELS_ENDPOINT };
