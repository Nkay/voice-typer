const { API_BASE, MistralError, errorForStatus, fetchWithTimeout } = require("./mistral.js");

const MODELS_ENDPOINT = `${API_BASE}/models`;

// No retry: the caller caches the failure and the Settings window gets a fresh
// attempt the next time it opens.
async function fetchChatModels({ apiKey, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!apiKey) throw new MistralError("NO_API_KEY", "No Mistral API key configured");

  let res;
  try {
    res = await fetchWithTimeout(
      MODELS_ENDPOINT,
      { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } },
      { fetchImpl, timeoutMs }
    );
  } catch (err) {
    throw new MistralError("NETWORK", `Network error: ${err.message}`);
  }

  if (!res.ok) throw errorForStatus(res.status);

  let data;
  try {
    data = await res.json();
  } catch {
    throw new MistralError("BAD_RESPONSE", "Malformed response from models API");
  }

  if (!data || !Array.isArray(data.data)) {
    throw new MistralError("BAD_RESPONSE", "Unexpected shape from models API");
  }

  const ids = new Set();
  for (const model of data.data) {
    if (!model || typeof model.id !== "string") continue;
    if (!model.capabilities || model.capabilities.completion_chat !== true) continue;
    ids.add(model.id);
  }
  return [...ids].sort();
}

module.exports = { fetchChatModels, MODELS_ENDPOINT };
