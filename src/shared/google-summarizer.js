const { GEMINI_API_BASE, GoogleError, errorForStatus, fetchWithTimeout } = require("./google.js");
const { streamText } = require("./sse.js");

const TEMPERATURE = 0.2;

// Gemini 3 and later think at "high" or "medium" unless told otherwise; "low"
// answers faster and is enough for a summary or a merge. Flash-Lite already
// defaults to "minimal", and older models do not know the setting.
function thinkingConfig(model) {
  const match = /^gemini-(\d+)/.exec(model);
  if (!match || Number(match[1]) < 3 || model.includes("lite")) return undefined;
  return { thinkingLevel: "low" };
}

// The text of one answer or one streamed chunk, without thought parts.
function textOf(data) {
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content
    ? data.candidates[0].content.parts
    : null;
  if (!Array.isArray(parts)) return "";
  return parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
}

async function summarize(transcript, opts = {}) {
  const {
    apiKey,
    model = "gemini-3.7-flash",
    prompt = "Summarise the transcript below concisely.",
    fetchImpl = fetch,
    timeoutMs = 30000,
    maxAttempts = 2,
    // With onDelta, the answer streams in: onDelta gets each new piece of text
    // and there is no retry.
    onDelta = null,
  } = opts;

  if (!apiKey) throw new GoogleError("NO_API_KEY", "No Google API key configured");
  if (typeof transcript !== "string" || transcript.trim().length === 0) {
    throw new GoogleError("NO_TRANSCRIPT", "Nothing to summarise");
  }

  const base = `${GEMINI_API_BASE}/models/${model}`;
  const endpoint = `${base}:generateContent?key=${apiKey}`;

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: prompt }] },
    contents: [{ role: "user", parts: [{ text: transcript }] }],
    generationConfig: { temperature: TEMPERATURE, thinkingConfig: thinkingConfig(model) },
  });
  if (onDelta) {
    const url = `${base}:streamGenerateContent?alt=sse&key=${apiKey}`;
    return streamSummary(url, body, { fetchImpl, timeoutMs, onDelta });
  }

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

    if (!res.ok) throw errorForStatus(res.status, await res.json().catch(() => null));

    let data;
    try {
      data = await res.json();
    } catch {
      throw new GoogleError("BAD_RESPONSE", "Malformed response from Gemini API");
    }

    const text = textOf(data).trim();
    if (text.length === 0) throw new GoogleError("BAD_RESPONSE", "Empty summary from Gemini API");
    return text;
  }

  throw lastNetworkError;
}

function deltaOf(data) {
  try {
    return textOf(JSON.parse(data));
  } catch {
    return "";
  }
}

async function streamSummary(url, body, { fetchImpl, timeoutMs, onDelta }) {
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, body };
  let result;
  try {
    result = await streamText(url, init, { fetchImpl, timeoutMs, deltaOf, onDelta });
  } catch (err) {
    if (err.fromCaller) throw err;
    throw new GoogleError("NETWORK", `Network error: ${err.message}`);
  }
  if (!result.res.ok) throw errorForStatus(result.res.status, await result.res.json().catch(() => null));
  const text = result.text.trim();
  if (text.length === 0) throw new GoogleError("BAD_RESPONSE", "Empty summary from Gemini API");
  return text;
}

module.exports = { summarize };
