const { GEMINI_API_BASE, GoogleError, errorForStatus, fetchWithTimeout } = require("./google.js");

const INTERACTIONS_ENDPOINT = `${GEMINI_API_BASE}/interactions`;

// The audio rides along inside the request as base64 rather than being staged
// through the Files API: a push-to-talk dictation is seconds long, so one
// request beats three, and nothing is left sitting in Google's file store.
// Inline requests are capped at 20 MB total; base64 inflates by 4/3, so the raw
// WAV ceiling is set below that to leave room for the envelope. At the app's
// 16 kHz mono 16-bit capture (32 kB/s) this is roughly seven minutes of speech.
const MAX_INLINE_WAV_BYTES = 14 * 1024 * 1024;

async function transcribe(wavBytes, opts = {}) {
  const {
    apiKey,
    model = "gemini-3.5-transcribe",
    language = "auto",
    fetchImpl = fetch,
    timeoutMs = 30000,
    maxAttempts = 2,
    // Dictionary terms, sent as custom_vocabulary.
    hints = [],
  } = opts;

  if (!apiKey) throw new GoogleError("NO_API_KEY", "No Google API key configured");
  if (wavBytes.length > MAX_INLINE_WAV_BYTES) {
    throw new GoogleError("TOO_LARGE", "Recording too long for Google transcription");
  }

  const audio = Buffer.from(wavBytes).toString("base64");
  const requestBody = (withHints) => {
    const transcriptionConfig = { mode: "smart" };
    if (language && language !== "auto") {
      transcriptionConfig.language_codes = [language];
    }
    if (withHints) transcriptionConfig.custom_vocabulary = hints;
    return JSON.stringify({
      model,
      input: [{ type: "audio", data: audio, mime_type: "audio/wav" }],
      generation_config: { transcription_config: transcriptionConfig },
    });
  };

  let useHints = hints.length > 0;
  let body = requestBody(useHints);
  let lastNetworkError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(
        INTERACTIONS_ENDPOINT,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body,
        },
        { fetchImpl, timeoutMs }
      );
    } catch (err) {
      lastNetworkError = new GoogleError("NETWORK", `Network error: ${err.message}`);
      continue;
    }

    if (!res.ok) {
      const err = errorForStatus(res.status, await res.json().catch(() => null));
      // A 400 that is not a bad key can be a rejected vocabulary. A transcript
      // without hints is better than none.
      if (res.status === 400 && useHints && err.code !== "UNAUTHORIZED") {
        console.warn("VoiceTyper: Google rejected the dictionary hints; trying without them");
        useHints = false;
        body = requestBody(false);
        attempt--;
        continue;
      }
      throw err;
    }

    let data;
    try {
      data = await res.json();
    } catch {
      throw new GoogleError("BAD_RESPONSE", "Malformed response from transcription API");
    }

    const text = extractText(data);
    if (text.length === 0) throw new GoogleError("BAD_RESPONSE", "Empty transcription from API");
    return text;
  }

  throw lastNetworkError;
}

// The REST Interaction resource has no output_text field — that exists only on
// the SDK objects. The transcript is assembled from the model_output step's
// text blocks, skipping any other step type (thoughts, tool calls) and any
// non-text content.
function extractText(data) {
  if (!data || !Array.isArray(data.steps)) return "";
  return data.steps
    .filter((step) => step && step.type === "model_output" && Array.isArray(step.content))
    .flatMap((step) => step.content)
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
}

module.exports = { transcribe, INTERACTIONS_ENDPOINT, MAX_INLINE_WAV_BYTES };
