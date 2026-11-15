const { API_BASE, MistralError, errorForStatus, fetchWithTimeout } = require("./mistral.js");

const ENDPOINT = `${API_BASE}/audio/transcriptions`;

// Kept as the historical name for this module's errors. Same class, so the code
// switch in controller.js is unaffected.
const TranscriberError = MistralError;

async function transcribe(wavBytes, opts = {}) {
  const {
    apiKey,
    model = "voxtral-mini-transcribe-3",
    language = "auto",
    fetchImpl = fetch,
    timeoutMs = 30000,
    maxAttempts = 2,
    // Dictionary terms, sent as context_bias (one form field per term).
    hints = [],
  } = opts;

  if (!apiKey) throw new TranscriberError("NO_API_KEY", "No Mistral API key configured");

  let useHints = hints.length > 0;
  let lastNetworkError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const form = new FormData();
    form.append("model", model);
    if (language && language !== "auto") form.append("language", language);
    if (useHints) for (const hint of hints) form.append("context_bias", hint);
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

    // A model without context biasing, or a hint list too long for the model's
    // context, gives a 400. A transcript without hints is better than none.
    if (res.status === 400 && useHints) {
      console.warn("VoiceTyper: Mistral rejected the dictionary hints; trying without them");
      useHints = false;
      attempt--;
      continue;
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
