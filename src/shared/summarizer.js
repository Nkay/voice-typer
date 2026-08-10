const { API_BASE, MistralError, errorForStatus, fetchWithTimeout } = require("./mistral.js");

const CHAT_ENDPOINT = `${API_BASE}/chat/completions`;

// Low temperature: a summary of dictation should track what was said rather than
// embellish it.
const TEMPERATURE = 0.2;

async function summarize(transcript, opts = {}) {
  const {
    apiKey,
    model = "mistral-small-latest",
    prompt = "Summarise the transcript below concisely.",
    fetchImpl = fetch,
    timeoutMs = 30000,
    maxAttempts = 2,
  } = opts;

  if (!apiKey) throw new MistralError("NO_API_KEY", "No Mistral API key configured");
  if (typeof transcript !== "string" || transcript.trim().length === 0) {
    throw new MistralError("NO_TRANSCRIPT", "Nothing to summarise");
  }

  const body = JSON.stringify({
    model,
    temperature: TEMPERATURE,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: transcript },
    ],
  });

  let lastNetworkError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(
        CHAT_ENDPOINT,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body,
        },
        { fetchImpl, timeoutMs }
      );
    } catch (err) {
      lastNetworkError = new MistralError("NETWORK", `Network error: ${err.message}`);
      continue; // retry
    }

    if (!res.ok) throw errorForStatus(res.status);

    let data;
    try {
      data = await res.json();
    } catch {
      throw new MistralError("BAD_RESPONSE", "Malformed response from chat API");
    }

    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : null;
    const text = typeof content === "string" ? content.trim() : "";
    if (text.length === 0) throw new MistralError("BAD_RESPONSE", "Empty summary from chat API");
    return text;
  }

  throw lastNetworkError;
}

module.exports = { summarize, CHAT_ENDPOINT };
