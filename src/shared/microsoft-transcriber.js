const { MicrosoftError, normalizeEndpoint, errorForStatus } = require("./microsoft.js");
const { fetchWithTimeout } = require("./mistral.js");

const API_VERSION = "2025-10-15";
const MODEL = "MAI-Transcribe-2";

// The non-streaming MAI model, used when Microsoft is one of several models
// asked at once. It runs on the Speech host of the same Foundry resource
// (<resource>.cognitiveservices.azure.com), with the same key. No retry: the
// other answers in the race cover a failed request.
async function transcribe(wavBytes, opts = {}) {
  const { apiKey, endpoint, language = "auto", fetchImpl = fetch, timeoutMs = 30000 } = opts;

  if (!apiKey) throw new MicrosoftError("NO_API_KEY", "No Microsoft API key configured");
  const root = normalizeEndpoint(endpoint);
  if (!root) throw new MicrosoftError("NO_ENDPOINT", "No Microsoft endpoint configured");
  const host = new URL(root).host.replace(/\.services\.ai\.azure\.com$/, ".cognitiveservices.azure.com");

  const definition = { enhancedMode: { enabled: true, model: MODEL } };
  if (language && language !== "auto") definition.locales = [language];
  const form = new FormData();
  form.append("audio", new Blob([wavBytes], { type: "audio/wav" }), "audio.wav");
  form.append("definition", JSON.stringify(definition));

  let res;
  try {
    res = await fetchWithTimeout(
      `https://${host}/speechtotext/transcriptions:transcribe?api-version=${API_VERSION}`,
      { method: "POST", headers: { "Ocp-Apim-Subscription-Key": apiKey }, body: form },
      { fetchImpl, timeoutMs }
    );
  } catch (err) {
    throw new MicrosoftError("NETWORK", `Network error: ${err.message}`);
  }
  if (!res.ok) throw errorForStatus(res.status);

  let data;
  try {
    data = await res.json();
  } catch {
    throw new MicrosoftError("BAD_RESPONSE", "Malformed response from transcription API");
  }
  const phrases = Array.isArray(data && data.combinedPhrases) ? data.combinedPhrases : [];
  return phrases.map((p) => (p && typeof p.text === "string" ? p.text : "")).join(" ").trim();
}

module.exports = { transcribe };
