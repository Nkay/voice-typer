const { GEMINI_API_BASE, GoogleError, errorForStatus, fetchWithTimeout } = require("./google.js");

const TEMPERATURE = 0.2;

async function summarize(transcript, opts = {}) {
  const {
    apiKey,
    model = "gemini-3.7-flash",
    prompt = "Summarise the transcript below concisely.",
    fetchImpl = fetch,
    timeoutMs = 30000,
    maxAttempts = 2,
  } = opts;

  if (!apiKey) throw new GoogleError("NO_API_KEY", "No Google API key configured");
  if (typeof transcript !== "string" || transcript.trim().length === 0) {
    throw new GoogleError("NO_TRANSCRIPT", "Nothing to summarise");
  }

  const endpoint = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: prompt }] },
    contents: [{ role: "user", parts: [{ text: transcript }] }],
    generationConfig: { temperature: TEMPERATURE },
  });

  let lastNetworkError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(
        endpoint,
        { method: "POST", headers: { "Content-Type": "application/json" }, body },
        { fetchImpl, timeoutMs }
      );
    } catch (err) {
      lastNetworkError = new GoogleError("NETWORK", `Network error: ${err.message}`);
      continue;
    }

    if (!res.ok) throw errorForStatus(res.status);

    let data;
    try {
      data = await res.json();
    } catch {
      throw new GoogleError("BAD_RESPONSE", "Malformed response from Gemini API");
    }

    const content =
      data &&
      Array.isArray(data.candidates) &&
      data.candidates[0] &&
      data.candidates[0].content &&
      Array.isArray(data.candidates[0].content.parts) &&
      data.candidates[0].content.parts[0]
        ? data.candidates[0].content.parts[0].text
        : null;
    const text = typeof content === "string" ? content.trim() : "";
    if (text.length === 0) throw new GoogleError("BAD_RESPONSE", "Empty summary from Gemini API");
    return text;
  }

  throw lastNetworkError;
}

module.exports = { summarize };
