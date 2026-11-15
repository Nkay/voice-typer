const { API_BASE, MistralError, errorForStatus, fetchWithTimeout } = require("./mistral.js");
const { streamText } = require("./sse.js");

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
    // With onDelta, the answer streams in: onDelta gets each new piece of text
    // and there is no retry.
    onDelta = null,
  } = opts;

  if (!apiKey) throw new MistralError("NO_API_KEY", "No Mistral API key configured");
  if (typeof transcript !== "string" || transcript.trim().length === 0) {
    throw new MistralError("NO_TRANSCRIPT", "Nothing to summarise");
  }

  const request = {
    model,
    temperature: TEMPERATURE,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: transcript },
    ],
  };
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  if (onDelta) {
    const init = { method: "POST", headers, body: JSON.stringify({ ...request, stream: true }) };
    return streamSummary(init, { fetchImpl, timeoutMs, onDelta });
  }
  const body = JSON.stringify(request);

  let lastNetworkError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(
        CHAT_ENDPOINT,
        { method: "POST", headers, body },
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

// The last event, "[DONE]", is no JSON and gives no text.
function deltaOf(data) {
  try {
    const delta = JSON.parse(data).choices[0].delta.content;
    return typeof delta === "string" ? delta : "";
  } catch {
    return "";
  }
}

async function streamSummary(init, { fetchImpl, timeoutMs, onDelta }) {
  let result;
  try {
    result = await streamText(CHAT_ENDPOINT, init, { fetchImpl, timeoutMs, deltaOf, onDelta });
  } catch (err) {
    if (err.fromCaller) throw err;
    throw new MistralError("NETWORK", `Network error: ${err.message}`);
  }
  if (!result.res.ok) throw errorForStatus(result.res.status);
  const text = result.text.trim();
  if (text.length === 0) throw new MistralError("BAD_RESPONSE", "Empty summary from chat API");
  return text;
}

module.exports = { summarize, CHAT_ENDPOINT };
