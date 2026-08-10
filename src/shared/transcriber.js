const { API_BASE, MistralError, errorForStatus, fetchWithTimeout } = require("./mistral.js");

const ENDPOINT = `${API_BASE}/audio/transcriptions`;

// Kept as the historical name for this module's errors. Same class, so the code
// switch in controller.js is unaffected.
const TranscriberError = MistralError;

async function transcribe(wavBytes, opts = {}) {
  const {
    apiKey,
    model = "voxtral-mini-latest",
    language = "auto",
    fetchImpl = fetch,
    timeoutMs = 30000,
    maxAttempts = 2,
  } = opts;

  if (!apiKey) throw new TranscriberError("NO_API_KEY", "No Mistral API key configured");

  let lastNetworkError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const form = new FormData();
    form.append("model", model);
    if (language && language !== "auto") form.append("language", language);
    form.append("file", new Blob([wavBytes], { type: "audio/wav" }), "audio.wav");

    let res;
    try {
      res = await fetchWithTimeout(
        ENDPOINT,
        { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form },
        { fetchImpl, timeoutMs }
      );
    } catch (err) {
      lastNetworkError = new TranscriberError("NETWORK", `Network error: ${err.message}`);
      continue; // retry
    }

    if (!res.ok) throw errorForStatus(res.status);

    let data;
    try {
      data = await res.json();
    } catch {
      throw new TranscriberError("BAD_RESPONSE", "Malformed response from transcription API");
    }
    return (data.text || "").trim();
  }

  throw lastNetworkError;
}

module.exports = { transcribe, TranscriberError, ENDPOINT };
