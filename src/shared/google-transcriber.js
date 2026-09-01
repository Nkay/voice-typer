const { GEMINI_API_BASE, GoogleError, errorForStatus, fetchWithTimeout } = require("./google.js");

const UPLOAD_ENDPOINT = `${GEMINI_API_BASE}/upload/v1beta/files`;
const INTERACTIONS_ENDPOINT = `${GEMINI_API_BASE}/interactions`;

async function uploadFile(wavBytes, { apiKey, fetchImpl, timeoutMs }) {
  const metadata = JSON.stringify({ file: { display_name: "audio.wav" } });
  const boundary = "----VoiceTyperBoundary";
  const parts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: audio/wav\r\n\r\n`,
  ];
  const encoder = new TextEncoder();
  const head = encoder.encode(parts[0] + parts[1]);
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + wavBytes.length + tail.length);
  body.set(head, 0);
  body.set(wavBytes, head.length);
  body.set(tail, head.length + wavBytes.length);

  const res = await fetchWithTimeout(
    UPLOAD_ENDPOINT,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
    { fetchImpl, timeoutMs }
  );

  if (!res.ok) throw errorForStatus(res.status);

  let data;
  try {
    data = await res.json();
  } catch {
    throw new GoogleError("BAD_RESPONSE", "Malformed response from Files API");
  }
  if (!data || !data.file || !data.file.uri) {
    throw new GoogleError("BAD_RESPONSE", "Missing file URI in upload response");
  }
  return { uri: data.file.uri, mimeType: data.file.mimeType || "audio/wav" };
}

async function transcribe(wavBytes, opts = {}) {
  const {
    apiKey,
    model = "gemini-3.5-transcribe",
    language = "auto",
    fetchImpl = fetch,
    timeoutMs = 30000,
    maxAttempts = 2,
  } = opts;

  if (!apiKey) throw new GoogleError("NO_API_KEY", "No Google API key configured");

  let lastNetworkError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let file;
    try {
      file = await uploadFile(wavBytes, { apiKey, fetchImpl, timeoutMs });
    } catch (err) {
      if (!(err instanceof GoogleError)) {
        lastNetworkError = new GoogleError("NETWORK", `Network error: ${err.message}`);
        continue;
      }
      throw err;
    }

    const transcriptionConfig = { mode: "smart" };
    if (language && language !== "auto") {
      transcriptionConfig.language_codes = [language];
    }

    const body = JSON.stringify({
      model,
      input: [{ type: "audio", uri: file.uri, mime_type: file.mimeType }],
      generation_config: { transcription_config: transcriptionConfig },
    });

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

    if (!res.ok) throw errorForStatus(res.status);

    let data;
    try {
      data = await res.json();
    } catch {
      throw new GoogleError("BAD_RESPONSE", "Malformed response from transcription API");
    }

    const text = data && typeof data.output_text === "string" ? data.output_text.trim() : "";
    if (text.length === 0) throw new GoogleError("BAD_RESPONSE", "Empty transcription from API");
    return text;
  }

  throw lastNetworkError;
}

module.exports = { transcribe, UPLOAD_ENDPOINT, INTERACTIONS_ENDPOINT };
