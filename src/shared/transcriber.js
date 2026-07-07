const ENDPOINT = "https://api.mistral.ai/v1/audio/transcriptions";

class TranscriberError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TranscriberError";
    this.code = code;
  }
}

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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      lastNetworkError = new TranscriberError("NETWORK", `Network error: ${err.message}`);
      continue; // retry
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401) throw new TranscriberError("UNAUTHORIZED", "Invalid Mistral API key");
    if (res.status === 429) throw new TranscriberError("RATE_LIMIT", "Rate limited");
    if (!res.ok) throw new TranscriberError("HTTP", `HTTP ${res.status}`);

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
