# Google Transcription Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google as an alternative/parallel transcription provider and Gemini as an alternative summary model, with a settings UI to choose between Mistral, Google, or both.

**Architecture:** Mirror the existing Mistral module structure (`google.js`, `google-transcriber.js`, `google-summarizer.js`, `google-models.js`) alongside the existing modules. The controller dispatches to the right provider(s) based on config. Secrets stores a second encrypted key file. The settings UI gains a Google API key field, a transcription provider select, and a merged model dropdown with provider prefixes.

**Tech Stack:** Electron, native `fetch()`, Google Gemini API (Files API + Interactions API + generateContent), vitest

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/shared/google.js` | API base URL, `GoogleError` class, `errorForStatus`, `fetchWithTimeout` |
| Create | `src/shared/google-transcriber.js` | Upload WAV → Files API, transcribe → Interactions API |
| Create | `src/shared/google-summarizer.js` | `summarize()` via Gemini `generateContent` |
| Create | `src/shared/google-models.js` | Fetch Gemini model list, filter for `generateContent` support |
| Create | `test/google.test.js` | Tests for `google.js` |
| Create | `test/google-transcriber.test.js` | Tests for `google-transcriber.js` |
| Create | `test/google-summarizer.test.js` | Tests for `google-summarizer.js` |
| Create | `test/google-models.test.js` | Tests for `google-models.js` |
| Modify | `src/shared/config.js` | Add `transcriptionProvider` field, validate provider, update `summaryModel` default handling |
| Modify | `test/config.test.js` | Tests for new config fields |
| Modify | `src/main/secrets.js` | Support two key files (Mistral + Google) |
| Modify | `test/secrets.test.js` | Tests for second key |
| Modify | `src/main/controller.js` | Dispatch transcription by provider, dispatch summary by model prefix |
| Modify | `test/controller.test.js` | Tests for provider dispatch, both-mode, Google summary |
| Modify | `src/main/boot.js` | Wire Google modules, dual model fetching, dual secrets, settings IPC changes |
| Modify | `test/boot.test.js` | Tests for boot wiring with Google |
| Modify | `src/settings/settings.html` | Google API key input, transcription provider select |
| Modify | `src/settings/settings.js` | Handle new fields, prefixed model dropdown |

---

### Task 1: Google base module (`google.js`)

**Files:**
- Create: `src/shared/google.js`
- Create: `test/google.test.js`

- [ ] **Step 1: Write the failing tests**

In `test/google.test.js`:

```js
import { describe, it, expect } from "vitest";
import { GEMINI_API_BASE, GoogleError, errorForStatus, fetchWithTimeout } from "../src/shared/google.js";

describe("google shared", () => {
  it("exposes the v1beta API base", () => {
    expect(GEMINI_API_BASE).toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  it("carries a code on the error", () => {
    const err = new GoogleError("NOPE", "nope");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("GoogleError");
    expect(err.code).toBe("NOPE");
    expect(err.message).toBe("nope");
  });

  it("maps statuses to codes", () => {
    expect(errorForStatus(401).code).toBe("UNAUTHORIZED");
    expect(errorForStatus(403).code).toBe("UNAUTHORIZED");
    expect(errorForStatus(429).code).toBe("RATE_LIMIT");
    expect(errorForStatus(500).code).toBe("HTTP");
    expect(errorForStatus(500).message).toBe("HTTP 500");
  });

  it("passes url and options through and returns the response", async () => {
    let captured;
    const fetchImpl = async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 200 };
    };
    const res = await fetchWithTimeout("https://x/y", { method: "POST" }, { fetchImpl });
    expect(res.status).toBe(200);
    expect(captured.url).toBe("https://x/y");
    expect(captured.init.method).toBe("POST");
    expect(captured.init.signal).toBeDefined();
  });

  it("aborts the signal once the timeout elapses", async () => {
    let signal;
    const fetchImpl = (_url, init) =>
      new Promise((resolve, reject) => {
        signal = init.signal;
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    await expect(
      fetchWithTimeout("https://x/y", {}, { fetchImpl, timeoutMs: 5 })
    ).rejects.toThrow(/aborted/);
    expect(signal.aborted).toBe(true);
  });

  it("propagates a fetch rejection", async () => {
    const fetchImpl = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(fetchWithTimeout("https://x/y", {}, { fetchImpl })).rejects.toThrow(/ECONNRESET/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/google.test.js`
Expected: FAIL — module `../src/shared/google.js` does not exist.

- [ ] **Step 3: Write the implementation**

In `src/shared/google.js`:

```js
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

class GoogleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GoogleError";
    this.code = code;
  }
}

function errorForStatus(status) {
  if (status === 401 || status === 403) return new GoogleError("UNAUTHORIZED", "Invalid Google API key");
  if (status === 429) return new GoogleError("RATE_LIMIT", "Rate limited");
  return new GoogleError("HTTP", `HTTP ${status}`);
}

async function fetchWithTimeout(url, options = {}, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { GEMINI_API_BASE, GoogleError, errorForStatus, fetchWithTimeout };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/google.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/google.js test/google.test.js
git commit -m "feat: add Google base module (GoogleError, fetchWithTimeout)"
```

---

### Task 2: Google transcriber

**Files:**
- Create: `src/shared/google-transcriber.js`
- Create: `test/google-transcriber.test.js`

- [ ] **Step 1: Write the failing tests**

In `test/google-transcriber.test.js`:

```js
import { describe, it, expect } from "vitest";
import { transcribe } from "../src/shared/google-transcriber.js";

const wav = new Uint8Array(44 + 2);

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("google transcribe", () => {
  it("throws NO_API_KEY when key is missing", async () => {
    await expect(transcribe(wav, { apiKey: "" })).rejects.toMatchObject({ code: "NO_API_KEY" });
  });

  it("uploads via Files API then transcribes via Interactions API", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers });
      if (url.includes("/upload")) {
        return jsonResponse(200, { file: { uri: "gs://bucket/file123", mimeType: "audio/wav" } });
      }
      return jsonResponse(200, { output_text: "  hallo welt  " });
    };
    const text = await transcribe(wav, { apiKey: "k", fetchImpl });
    expect(text).toBe("hallo welt");

    // First call: upload
    expect(calls[0].url).toContain("/upload/v1beta/files");
    expect(calls[0].headers["x-goog-api-key"]).toBe("k");

    // Second call: transcribe
    expect(calls[1].url).toContain("/v1beta/interactions");
    expect(calls[1].headers["x-goog-api-key"]).toBe("k");
  });

  it("maps 401 to UNAUTHORIZED", async () => {
    const fetchImpl = async () => jsonResponse(401, {});
    await expect(transcribe(wav, { apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("maps 429 to RATE_LIMIT", async () => {
    const fetchImpl = async () => jsonResponse(429, {});
    await expect(transcribe(wav, { apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "RATE_LIMIT",
    });
  });

  it("retries once on network error then succeeds", async () => {
    let calls = 0;
    const fetchImpl = async (url) => {
      calls++;
      if (calls === 1) throw new Error("ECONNRESET");
      if (url.includes("/upload")) {
        return jsonResponse(200, { file: { uri: "gs://f", mimeType: "audio/wav" } });
      }
      return jsonResponse(200, { output_text: "ok" });
    };
    const text = await transcribe(wav, { apiKey: "k", fetchImpl, maxAttempts: 2 });
    expect(text).toBe("ok");
  });

  it("throws UPLOAD_FAILED when the upload step returns a non-2xx", async () => {
    const fetchImpl = async () => jsonResponse(500, {});
    await expect(transcribe(wav, { apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "HTTP",
    });
  });

  it("throws BAD_RESPONSE for a malformed upload response", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}), // missing file.uri
    });
    await expect(transcribe(wav, { apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("throws BAD_RESPONSE when the transcription response has no output_text", async () => {
    let step = 0;
    const fetchImpl = async () => {
      step++;
      if (step === 1) {
        return jsonResponse(200, { file: { uri: "gs://f", mimeType: "audio/wav" } });
      }
      return jsonResponse(200, {}); // missing output_text
    };
    await expect(transcribe(wav, { apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("passes language codes when language is not auto", async () => {
    let transcribeBody;
    const fetchImpl = async (url, init) => {
      if (url.includes("/upload")) {
        return jsonResponse(200, { file: { uri: "gs://f", mimeType: "audio/wav" } });
      }
      transcribeBody = JSON.parse(init.body);
      return jsonResponse(200, { output_text: "ok" });
    };
    await transcribe(wav, { apiKey: "k", language: "de", fetchImpl });
    expect(transcribeBody.generation_config.transcription_config.language_codes).toEqual(["de"]);
  });

  it("omits language_codes when language is auto", async () => {
    let transcribeBody;
    const fetchImpl = async (url, init) => {
      if (url.includes("/upload")) {
        return jsonResponse(200, { file: { uri: "gs://f", mimeType: "audio/wav" } });
      }
      transcribeBody = JSON.parse(init.body);
      return jsonResponse(200, { output_text: "ok" });
    };
    await transcribe(wav, { apiKey: "k", language: "auto", fetchImpl });
    expect(transcribeBody.generation_config.transcription_config.language_codes).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/google-transcriber.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

In `src/shared/google-transcriber.js`:

```js
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
      if (err instanceof GoogleError && err.code === "NETWORK") {
        lastNetworkError = err;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/google-transcriber.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/google-transcriber.js test/google-transcriber.test.js
git commit -m "feat: add Google transcriber (Files API upload + Interactions API)"
```

---

### Task 3: Google summarizer

**Files:**
- Create: `src/shared/google-summarizer.js`
- Create: `test/google-summarizer.test.js`

- [ ] **Step 1: Write the failing tests**

In `test/google-summarizer.test.js`:

```js
import { describe, it, expect } from "vitest";
import { summarize } from "../src/shared/google-summarizer.js";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function okResponse(text) {
  return jsonResponse(200, {
    candidates: [{ content: { parts: [{ text }] } }],
  });
}

describe("google summarize", () => {
  it("throws NO_API_KEY when key is missing", async () => {
    await expect(summarize("hallo", { apiKey: "" })).rejects.toMatchObject({ code: "NO_API_KEY" });
  });

  it("throws NO_TRANSCRIPT for empty input", async () => {
    await expect(summarize("   ", { apiKey: "k" })).rejects.toMatchObject({
      code: "NO_TRANSCRIPT",
    });
  });

  it("posts the prompt as systemInstruction and transcript as user content", async () => {
    let captured;
    const fetchImpl = async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return okResponse("  short summary  ");
    };
    const out = await summarize("a long transcript", {
      apiKey: "k",
      model: "gemini-3.7-flash",
      prompt: "Be terse.",
      fetchImpl,
    });

    expect(out).toBe("short summary");
    expect(captured.url).toContain("/models/gemini-3.7-flash:generateContent");
    expect(captured.url).toContain("key=k");
    expect(captured.body.systemInstruction.parts[0].text).toBe("Be terse.");
    expect(captured.body.contents[0].role).toBe("user");
    expect(captured.body.contents[0].parts[0].text).toBe("a long transcript");
  });

  it("defaults to gemini-3.7-flash", async () => {
    let url;
    const fetchImpl = async (u) => {
      url = u;
      return okResponse("s");
    };
    await summarize("t", { apiKey: "k", fetchImpl });
    expect(url).toContain("/models/gemini-3.7-flash:generateContent");
  });

  it("maps 401 to UNAUTHORIZED", async () => {
    await expect(
      summarize("t", { apiKey: "k", fetchImpl: async () => jsonResponse(401, {}) })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("maps 429 to RATE_LIMIT", async () => {
    await expect(
      summarize("t", { apiKey: "k", fetchImpl: async () => jsonResponse(429, {}) })
    ).rejects.toMatchObject({ code: "RATE_LIMIT" });
  });

  it("retries once on network error then succeeds", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) throw new Error("ECONNRESET");
      return okResponse("ok");
    };
    const out = await summarize("t", { apiKey: "k", fetchImpl, maxAttempts: 2 });
    expect(out).toBe("ok");
    expect(calls).toBe(2);
  });

  it("gives up with NETWORK after exhausting attempts", async () => {
    const fetchImpl = async () => { throw new Error("ECONNRESET"); };
    await expect(
      summarize("t", { apiKey: "k", fetchImpl, maxAttempts: 2 })
    ).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("maps an unparseable body to BAD_RESPONSE", async () => {
    const fetchImpl = async () => ({
      ok: true, status: 200,
      json: async () => { throw new SyntaxError("bad json"); },
    });
    await expect(summarize("t", { apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("maps a missing or blank candidate to BAD_RESPONSE", async () => {
    await expect(
      summarize("t", { apiKey: "k", fetchImpl: async () => jsonResponse(200, { candidates: [] }) })
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });

    await expect(
      summarize("t", { apiKey: "k", fetchImpl: async () => okResponse("   ") })
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("uses low temperature", async () => {
    let body;
    const fetchImpl = async (_url, init) => {
      body = JSON.parse(init.body);
      return okResponse("s");
    };
    await summarize("t", { apiKey: "k", fetchImpl });
    expect(body.generationConfig.temperature).toBe(0.2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/google-summarizer.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

In `src/shared/google-summarizer.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/google-summarizer.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/google-summarizer.js test/google-summarizer.test.js
git commit -m "feat: add Google summarizer (Gemini generateContent)"
```

---

### Task 4: Google models fetcher

**Files:**
- Create: `src/shared/google-models.js`
- Create: `test/google-models.test.js`

- [ ] **Step 1: Write the failing tests**

In `test/google-models.test.js`:

```js
import { describe, it, expect } from "vitest";
import { fetchGeminiModels, MODELS_ENDPOINT } from "../src/shared/google-models.js";

function listResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const SAMPLE = {
  models: [
    {
      name: "models/gemini-3.7-flash",
      supportedGenerationMethods: ["generateContent", "countTokens"],
    },
    {
      name: "models/gemini-3.5-transcribe",
      supportedGenerationMethods: ["generateContent"],
    },
    {
      name: "models/embedding-001",
      supportedGenerationMethods: ["embedContent"],
    },
    {
      name: "models/gemini-2.5-flash",
      supportedGenerationMethods: ["generateContent"],
    },
  ],
};

describe("fetchGeminiModels", () => {
  it("throws NO_API_KEY when the key is missing", async () => {
    await expect(fetchGeminiModels({ apiKey: "" })).rejects.toMatchObject({ code: "NO_API_KEY" });
  });

  it("returns only generateContent-capable models, sorted, with short names", async () => {
    let captured;
    const fetchImpl = async (url, init) => {
      captured = { url };
      return listResponse(200, SAMPLE);
    };
    const ids = await fetchGeminiModels({ apiKey: "k", fetchImpl });

    expect(ids).toEqual(["gemini-2.5-flash", "gemini-3.5-transcribe", "gemini-3.7-flash"]);
    expect(captured.url).toContain("/v1beta/models");
    expect(captured.url).toContain("key=k");
  });

  it("maps 401 to UNAUTHORIZED", async () => {
    await expect(
      fetchGeminiModels({ apiKey: "k", fetchImpl: async () => listResponse(401, {}) })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("maps a network failure to NETWORK", async () => {
    const fetchImpl = async () => { throw new Error("ENOTFOUND"); };
    await expect(fetchGeminiModels({ apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "NETWORK",
    });
  });

  it("maps an unparseable body to BAD_RESPONSE", async () => {
    const fetchImpl = async () => ({
      ok: true, status: 200,
      json: async () => { throw new SyntaxError("bad json"); },
    });
    await expect(fetchGeminiModels({ apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("maps a body without a models array to BAD_RESPONSE", async () => {
    await expect(
      fetchGeminiModels({ apiKey: "k", fetchImpl: async () => listResponse(200, {}) })
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("returns an empty array when no model supports generateContent", async () => {
    const body = {
      models: [{ name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] }],
    };
    const ids = await fetchGeminiModels({
      apiKey: "k",
      fetchImpl: async () => listResponse(200, body),
    });
    expect(ids).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/google-models.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

In `src/shared/google-models.js`:

```js
const { GEMINI_API_BASE, GoogleError, errorForStatus, fetchWithTimeout } = require("./google.js");

const MODELS_ENDPOINT = `${GEMINI_API_BASE}/models`;

async function fetchGeminiModels({ apiKey, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!apiKey) throw new GoogleError("NO_API_KEY", "No Google API key configured");

  let res;
  try {
    res = await fetchWithTimeout(
      `${MODELS_ENDPOINT}?key=${apiKey}`,
      { method: "GET" },
      { fetchImpl, timeoutMs }
    );
  } catch (err) {
    throw new GoogleError("NETWORK", `Network error: ${err.message}`);
  }

  if (!res.ok) throw errorForStatus(res.status);

  let data;
  try {
    data = await res.json();
  } catch {
    throw new GoogleError("BAD_RESPONSE", "Malformed response from models API");
  }

  if (!data || !Array.isArray(data.models)) {
    throw new GoogleError("BAD_RESPONSE", "Unexpected shape from models API");
  }

  const ids = new Set();
  for (const model of data.models) {
    if (!model || typeof model.name !== "string") continue;
    if (!Array.isArray(model.supportedGenerationMethods)) continue;
    if (!model.supportedGenerationMethods.includes("generateContent")) continue;
    // Strip "models/" prefix: "models/gemini-3.7-flash" → "gemini-3.7-flash"
    ids.add(model.name.replace(/^models\//, ""));
  }
  return [...ids].sort();
}

module.exports = { fetchGeminiModels, MODELS_ENDPOINT: `${GEMINI_API_BASE}/models` };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/google-models.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/google-models.js test/google-models.test.js
git commit -m "feat: add Google models fetcher (Gemini API)"
```

---

### Task 5: Config — add `transcriptionProvider` field

**Files:**
- Modify: `src/shared/config.js`
- Modify: `test/config.test.js`

- [ ] **Step 1: Write the failing tests**

Append to the `describe("config", ...)` block in `test/config.test.js`:

```js
it("defaults transcriptionProvider to mistral", () => {
  const c = cfg.mergeConfig({});
  expect(c.transcriptionProvider).toBe("mistral");
});

it("accepts valid transcription providers", () => {
  for (const p of ["mistral", "google", "both"]) {
    expect(cfg.validateConfig({ ...cfg.DEFAULTS, transcriptionProvider: p }).transcriptionProvider).toBe(p);
  }
});

it("falls back to mistral for an invalid provider", () => {
  expect(
    cfg.validateConfig({ ...cfg.DEFAULTS, transcriptionProvider: "openai" }).transcriptionProvider
  ).toBe("mistral");
});

it("falls back to mistral for a non-string provider", () => {
  expect(
    cfg.validateConfig({ ...cfg.DEFAULTS, transcriptionProvider: null }).transcriptionProvider
  ).toBe("mistral");
});

it("round-trips transcriptionProvider through save and load", () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vt-")), "config.json");
  cfg.saveConfig(p, cfg.mergeConfig({ transcriptionProvider: "both" }));
  const c = cfg.loadConfig(p);
  expect(c.transcriptionProvider).toBe("both");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/config.test.js`
Expected: FAIL — `transcriptionProvider` is `undefined`.

- [ ] **Step 3: Add `transcriptionProvider` to config**

In `src/shared/config.js`, add to `DEFAULTS`:

```js
const DEFAULTS = {
  recordKey: "RIGHT ALT",
  summaryModifier: "RIGHT SHIFT",
  language: "auto",
  model: "voxtral-mini-latest",
  summaryModel: "mistral-small-latest",
  summaryPrompt: DEFAULT_SUMMARY_PROMPT,
  separator: "blank-line",
  sampleRate: 16000,
  micDeviceId: null,
  autoLaunch: false,
  transcriptionProvider: "mistral",
};
```

Add a `PROVIDERS` constant:

```js
const PROVIDERS = ["mistral", "google", "both"];
```

In `validateConfig`, add after the `autoLaunch` line:

```js
if (!PROVIDERS.includes(c.transcriptionProvider)) c.transcriptionProvider = DEFAULTS.transcriptionProvider;
```

Export `PROVIDERS`:

```js
module.exports = {
  DEFAULTS,
  LANGUAGES,
  SEPARATORS,
  PROVIDERS,
  DEFAULT_SUMMARY_PROMPT,
  summaryModifierError,
  mergeConfig,
  validateConfig,
  loadConfig,
  saveConfig,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/config.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/config.js test/config.test.js
git commit -m "feat: add transcriptionProvider config field (mistral/google/both)"
```

---

### Task 6: Secrets — support dual API keys

**Files:**
- Modify: `src/main/secrets.js`
- Modify: `test/secrets.test.js`

- [ ] **Step 1: Write the failing tests**

Append to the `describe("secrets", ...)` block in `test/secrets.test.js`:

```js
describe("dual key support", () => {
  it("stores and retrieves a Google key independently", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vt-sec-"));
    const s = createSecrets({
      safeStorage: fakeSafeStorage,
      filePath: path.join(dir, "key.enc"),
      googleFilePath: path.join(dir, "google-key.enc"),
      fs,
    });
    expect(s.hasGoogleKey()).toBe(false);
    expect(s.getGoogleKey()).toBe(null);

    s.setGoogleKey("goog-123");
    expect(s.hasGoogleKey()).toBe(true);
    expect(s.getGoogleKey()).toBe("goog-123");

    // Mistral key is unaffected
    expect(s.hasKey()).toBe(false);
  });

  it("clears the Google key when set to empty", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vt-sec-"));
    const s = createSecrets({
      safeStorage: fakeSafeStorage,
      filePath: path.join(dir, "key.enc"),
      googleFilePath: path.join(dir, "google-key.enc"),
      fs,
    });
    s.setGoogleKey("x");
    s.setGoogleKey("");
    expect(s.hasGoogleKey()).toBe(false);
  });

  it("works with both keys simultaneously", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vt-sec-"));
    const s = createSecrets({
      safeStorage: fakeSafeStorage,
      filePath: path.join(dir, "key.enc"),
      googleFilePath: path.join(dir, "google-key.enc"),
      fs,
    });
    s.setKey("mistral-abc");
    s.setGoogleKey("google-xyz");
    expect(s.getKey()).toBe("mistral-abc");
    expect(s.getGoogleKey()).toBe("google-xyz");
  });

  it("falls back gracefully when googleFilePath is not provided", () => {
    const s = createSecrets({
      safeStorage: fakeSafeStorage,
      filePath: tmpFile(),
      fs,
    });
    expect(s.hasGoogleKey()).toBe(false);
    expect(s.getGoogleKey()).toBe(null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/secrets.test.js`
Expected: FAIL — `hasGoogleKey` is not a function.

- [ ] **Step 3: Extend secrets with Google key methods**

Replace `src/main/secrets.js`:

```js
const nodeFs = require("fs");

function createSecrets({ safeStorage, filePath, googleFilePath, fs = nodeFs }) {
  function _has(p) {
    return p && fs.existsSync(p);
  }
  function _get(p) {
    if (!_has(p)) return null;
    const buf = fs.readFileSync(p);
    return safeStorage.decryptString(buf);
  }
  function _set(p, key) {
    if (!p) return;
    if (!key) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Encryption is not available on this system");
    }
    fs.writeFileSync(p, safeStorage.encryptString(key));
  }

  return {
    hasKey() { return _has(filePath); },
    getKey() { return _get(filePath); },
    setKey(key) { _set(filePath, key); },
    hasGoogleKey() { return _has(googleFilePath); },
    getGoogleKey() { return _get(googleFilePath); },
    setGoogleKey(key) { _set(googleFilePath, key); },
  };
}

module.exports = { createSecrets };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/secrets.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/secrets.js test/secrets.test.js
git commit -m "feat: extend secrets with Google API key storage"
```

---

### Task 7: Controller — provider dispatch

**Files:**
- Modify: `src/main/controller.js`
- Modify: `test/controller.test.js`

- [ ] **Step 1: Write the failing tests**

Append to the `describe("Controller", ...)` block in `test/controller.test.js`:

```js
it("dispatches to googleTranscribe when provider is google", async () => {
  let googleCalled = false;
  const h = harness({
    getConfig: () => ({
      model: "voxtral-mini-latest",
      language: "auto",
      summaryModel: "mistral-small-latest",
      summaryPrompt: "Be terse.",
      separator: "blank-line",
      transcriptionProvider: "google",
    }),
    googleTranscribe: async () => {
      googleCalled = true;
      return "google text";
    },
    transcribe: async () => {
      throw new Error("should not call mistral");
    },
  });
  h.controller.start();
  h.fireWav(wavOfMs(1000));
  await new Promise((r) => setTimeout(r, 0));
  expect(googleCalled).toBe(true);
  expect(h.typed).toEqual(["google text"]);
});

it("dispatches to both providers in both mode and types both results with labels", async () => {
  const h = harness({
    getConfig: () => ({
      model: "voxtral-mini-latest",
      language: "auto",
      summaryModel: "mistral-small-latest",
      summaryPrompt: "Be terse.",
      separator: "blank-line",
      transcriptionProvider: "both",
    }),
    transcribe: async () => "mistral text",
    googleTranscribe: async () => "google text",
  });
  h.controller.start();
  h.fireWav(wavOfMs(1000));
  await new Promise((r) => setTimeout(r, 0));
  expect(h.typed).toEqual([{
    parts: ["[Mistral]\nmistral text", "[Google]\ngoogle text"],
    separator: "blank-line",
  }]);
});

it("types the surviving result and notifies when one provider fails in both mode", async () => {
  const h = harness({
    getConfig: () => ({
      model: "voxtral-mini-latest",
      language: "auto",
      summaryModel: "mistral-small-latest",
      summaryPrompt: "Be terse.",
      separator: "blank-line",
      transcriptionProvider: "both",
    }),
    transcribe: async () => {
      throw new Error("mistral down");
    },
    googleTranscribe: async () => "google text",
  });
  h.controller.start();
  h.fireWav(wavOfMs(1000));
  await new Promise((r) => setTimeout(r, 0));
  expect(h.typed).toEqual(["[Google]\ngoogle text"]);
  expect(h.notifications.some((n) => n[1].includes("Mistral"))).toBe(true);
});

it("shows error when both providers fail in both mode", async () => {
  const h = harness({
    getConfig: () => ({
      model: "voxtral-mini-latest",
      language: "auto",
      summaryModel: "mistral-small-latest",
      summaryPrompt: "Be terse.",
      separator: "blank-line",
      transcriptionProvider: "both",
    }),
    transcribe: async () => {
      throw new TranscriberError("UNAUTHORIZED", "bad key");
    },
    googleTranscribe: async () => {
      throw new Error("google down");
    },
  });
  h.controller.start();
  h.fireWav(wavOfMs(1000));
  await new Promise((r) => setTimeout(r, 0));
  expect(h.typed).toEqual([]);
  expect(h.states).toContain("error");
  expect(h.notifications.length).toBeGreaterThan(0);
});

it("dispatches summary to googleSummarize when summaryModel has google/ prefix", async () => {
  let googleSummarizeCalled = false;
  let capturedModel;
  const h = harness({
    getConfig: () => ({
      model: "voxtral-mini-latest",
      language: "auto",
      summaryModel: "google/gemini-3.7-flash",
      summaryPrompt: "Be terse.",
      separator: "blank-line",
      transcriptionProvider: "mistral",
    }),
    googleSummarize: async (text, opts) => {
      googleSummarizeCalled = true;
      capturedModel = opts.model;
      return "google summary";
    },
    summarize: async () => {
      throw new Error("should not call mistral summarize");
    },
  });
  h.controller.start();
  h.hotkey.emit("record-start");
  h.advance(1200);
  h.hotkey.emit("record-stop", { mode: "summary" });
  h.fireWav(wavOfMs(1000));
  await new Promise((r) => setTimeout(r, 0));
  expect(googleSummarizeCalled).toBe(true);
  expect(capturedModel).toBe("gemini-3.7-flash");
  expect(h.typed).toEqual([{ parts: ["text", "google summary"], separator: "blank-line" }]);
});

it("dispatches summary to mistral when summaryModel has mistral/ prefix", async () => {
  let capturedModel;
  const h = harness({
    getConfig: () => ({
      model: "voxtral-mini-latest",
      language: "auto",
      summaryModel: "mistral/mistral-large-latest",
      summaryPrompt: "Be terse.",
      separator: "blank-line",
      transcriptionProvider: "mistral",
    }),
    summarize: async (text, opts) => {
      capturedModel = opts.model;
      return "mistral summary";
    },
  });
  h.controller.start();
  h.hotkey.emit("record-start");
  h.advance(1200);
  h.hotkey.emit("record-stop", { mode: "summary" });
  h.fireWav(wavOfMs(1000));
  await new Promise((r) => setTimeout(r, 0));
  expect(capturedModel).toBe("mistral-large-latest");
});

it("dispatches summary to mistral when summaryModel has no prefix", async () => {
  let mistralCalled = false;
  const h = harness({
    getConfig: () => ({
      model: "voxtral-mini-latest",
      language: "auto",
      summaryModel: "mistral-small-latest",
      summaryPrompt: "Be terse.",
      separator: "blank-line",
      transcriptionProvider: "mistral",
    }),
    summarize: async () => {
      mistralCalled = true;
      return "s";
    },
  });
  h.controller.start();
  h.hotkey.emit("record-start");
  h.advance(1200);
  h.hotkey.emit("record-stop", { mode: "summary" });
  h.fireWav(wavOfMs(1000));
  await new Promise((r) => setTimeout(r, 0));
  expect(mistralCalled).toBe(true);
});
```

Also update the `harness` function. Add these three lines to the `deps` object (after the existing `getApiKey` line):

```js
    getGoogleApiKey: overrides.getGoogleApiKey || (() => "google-key"),
    googleTranscribe: overrides.googleTranscribe || (async () => "google-text"),
    googleSummarize: overrides.googleSummarize || (async () => "google-summary"),
```
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/controller.test.js`
Expected: FAIL — `googleTranscribe` not called, `both` mode not implemented.

- [ ] **Step 3: Update the Controller**

In `src/main/controller.js`, update the constructor to accept new deps:

```js
constructor(deps) {
  // ... existing ...
  this.googleTranscribe = deps.googleTranscribe;
  this.googleSummarize = deps.googleSummarize;
  // ...
}
```

Add `getGoogleApiKey` to the constructor:

```js
this.getGoogleApiKey = deps.getGoogleApiKey;
```

Replace `_pump()` with provider-aware dispatch:

```js
async _transcribeBoth(bytes, mode, cfg) {
  const [mistralResult, googleResult] = await Promise.allSettled([
    this.transcribe(bytes, { apiKey: this.getApiKey(), model: cfg.model, language: cfg.language }),
    this.googleTranscribe(bytes, { apiKey: this.getGoogleApiKey(), language: cfg.language }),
  ]);

  const mistralOk = mistralResult.status === "fulfilled" && mistralResult.value;
  const googleOk = googleResult.status === "fulfilled" && googleResult.value;

  if (!mistralOk && !googleOk) {
    throw mistralResult.reason || googleResult.reason;
  }

  if (mistralOk && googleOk) {
    await this._safeType(() =>
      this.typer.typeParts(
        [`[Mistral]\n${mistralResult.value}`, `[Google]\n${googleResult.value}`],
        cfg.separator
      )
    );
    return;
  }

  const label = mistralOk ? "Mistral" : "Google";
  const failedLabel = mistralOk ? "Google" : "Mistral";
  const text = mistralOk ? mistralResult.value : googleResult.value;
  const reason = mistralOk ? googleResult.reason : mistralResult.reason;
  this.notify("VoiceTyper", `${failedLabel} transcription failed: ${reason?.message || "unknown error"}`);
  await this._safeType(() => this.typer.type(`[${label}]\n${text}`));
}
```

Update `_typeResult` to dispatch summaries by provider:

```js
async _typeResult(text, mode, cfg) {
  if (mode !== "summary") {
    await this._safeType(() => this.typer.type(text));
    return;
  }

  let summary;
  try {
    const isGoogle = cfg.summaryModel.startsWith("google/");
    const model = cfg.summaryModel.replace(/^(google|mistral)\//, "");
    const summarizeFn = isGoogle ? this.googleSummarize : this.summarize;
    const apiKey = isGoogle ? this.getGoogleApiKey() : this.getApiKey();

    summary = await summarizeFn(text, {
      apiKey,
      model,
      prompt: cfg.summaryPrompt,
      timeoutMs: 10000,
      maxAttempts: 1,
    });
  } catch (err) {
    console.error("VoiceTyper: summarization failed", err);
    this.notify("VoiceTyper", "Summary failed — typed transcript only");
    await this._safeType(() => this.typer.type(text));
    return;
  }

  await this._safeType(() => this.typer.typeParts([text, summary], cfg.separator));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/controller.test.js`
Expected: all PASS (both old and new tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/controller.js test/controller.test.js
git commit -m "feat: controller dispatches transcription by provider and summary by model prefix"
```

---

### Task 8: Boot wiring — Google modules

**Files:**
- Modify: `src/main/boot.js`
- Modify: `test/boot.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/boot.test.js`:

First update `fakeDeps()` to include `fetchGeminiModels`:

```js
// Add to fakeDeps():
deps.fetchGeminiModels = async () => ["gemini-2.5-flash", "gemini-3.7-flash"];
```

Add new tests:

```js
it("settings:get returns hasGoogleKey", async () => {
  const { deps, captured } = fakeDeps();
  boot(deps);
  captured.readyCb();

  const result = await captured.handlers["settings:get"]();
  expect("hasGoogleKey" in result).toBe(true);
  expect(result.hasGoogleKey).toBe(false);
});

it("settings:get returns merged models with provider prefixes", async () => {
  const { deps, captured } = fakeDeps();
  fs.writeFileSync(path.join(captured.userDataDir, "key.enc"), Buffer.from("mistral-key"));
  fs.writeFileSync(path.join(captured.userDataDir, "google-key.enc"), Buffer.from("google-key"));
  boot(deps);
  captured.readyCb();

  const result = await captured.handlers["settings:get"]();
  expect(result.models).toContain("mistral/mistral-large-latest");
  expect(result.models).toContain("mistral/mistral-small-latest");
  expect(result.models).toContain("google/gemini-2.5-flash");
  expect(result.models).toContain("google/gemini-3.7-flash");
});

it("settings:save stores the Google API key", async () => {
  const { deps, captured } = fakeDeps();
  boot(deps);
  captured.readyCb();

  const result = await captured.handlers["settings:save"](null, {
    config: { recordKey: "RIGHT ALT", summaryModifier: "F13" },
    apiKey: "",
    googleApiKey: "goog-test-key",
  });
  expect(result.ok).toBe(true);

  const after = await captured.handlers["settings:get"]();
  expect(after.hasGoogleKey).toBe(true);
});

it("settings:save rejects google/both provider without a Google key", async () => {
  const { deps, captured } = fakeDeps();
  boot(deps);
  captured.readyCb();

  const result = await captured.handlers["settings:save"](null, {
    config: { recordKey: "RIGHT ALT", summaryModifier: "F13", transcriptionProvider: "google" },
    apiKey: "",
    googleApiKey: "",
  });
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/Google API key/i);
});

it("settings:save rejects google/ summary model without a Google key", async () => {
  const { deps, captured } = fakeDeps();
  fs.writeFileSync(path.join(captured.userDataDir, "key.enc"), Buffer.from("mistral-key"));
  boot(deps);
  captured.readyCb();

  const result = await captured.handlers["settings:save"](null, {
    config: {
      recordKey: "RIGHT ALT",
      summaryModifier: "F13",
      transcriptionProvider: "mistral",
      summaryModel: "google/gemini-3.7-flash",
    },
    apiKey: "",
    googleApiKey: "",
  });
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/Google API key/i);
});

it("settings:save accepts google provider when Google key exists", async () => {
  const { deps, captured } = fakeDeps();
  fs.writeFileSync(path.join(captured.userDataDir, "google-key.enc"), Buffer.from("gk"));
  boot(deps);
  captured.readyCb();

  const result = await captured.handlers["settings:save"](null, {
    config: { recordKey: "RIGHT ALT", summaryModifier: "F13", transcriptionProvider: "google" },
    apiKey: "",
    googleApiKey: "",
  });
  expect(result.ok).toBe(true);
  expect(result.models).toBeDefined();
});

it("fetches models from both providers when both keys exist", async () => {
  const { deps, captured } = fakeDeps();
  fs.writeFileSync(path.join(captured.userDataDir, "key.enc"), Buffer.from("mk"));
  fs.writeFileSync(path.join(captured.userDataDir, "google-key.enc"), Buffer.from("gk"));

  let mistralCalls = 0;
  let googleCalls = 0;
  deps.fetchChatModels = async () => { mistralCalls++; return ["mistral-small-latest"]; };
  deps.fetchGeminiModels = async () => { googleCalls++; return ["gemini-3.7-flash"]; };

  boot(deps);
  captured.readyCb();

  const result = await captured.handlers["settings:get"]();
  expect(mistralCalls).toBe(1);
  expect(googleCalls).toBe(1);
  expect(result.models).toContain("mistral/mistral-small-latest");
  expect(result.models).toContain("google/gemini-3.7-flash");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/boot.test.js`
Expected: FAIL — `hasGoogleKey` not in result, etc.

- [ ] **Step 3: Update boot.js**

Add imports at the top:

```js
const { transcribe: googleTranscribe } = require("../shared/google-transcriber.js");
const { summarize: googleSummarize } = require("../shared/google-summarizer.js");
const { fetchGeminiModels: defaultFetchGeminiModels } = require("../shared/google-models.js");
```

Add `fetchGeminiModels` to the boot parameter:

```js
function boot({
  // ... existing params ...
  fetchGeminiModels = defaultFetchGeminiModels,
}) {
```

Update `app.whenReady().then(...)`:

After creating `state.secrets`, add the Google key path:

```js
const googleKeyPath = path.join(userData, "google-key.enc");
state.secrets = createSecrets({ safeStorage, filePath: keyPath, googleFilePath: googleKeyPath });
```

Update `refreshModels` to fetch from both providers:

```js
const refreshModels = async () => {
  const hasMistral = state.secrets.hasKey();
  const hasGoogle = state.secrets.hasGoogleKey();

  if (!hasMistral && !hasGoogle) {
    state.models = null;
    state.modelsError = null;
    return;
  }

  const results = await Promise.allSettled([
    hasMistral
      ? fetchChatModels({ apiKey: state.secrets.getKey() })
      : Promise.resolve([]),
    hasGoogle
      ? fetchGeminiModels({ apiKey: state.secrets.getGoogleKey() })
      : Promise.resolve([]),
  ]);

  const mistralModels = results[0].status === "fulfilled" ? results[0].value : [];
  const googleModels = results[1].status === "fulfilled" ? results[1].value : [];
  const errors = [];
  if (results[0].status === "rejected" && hasMistral) {
    errors.push(`Mistral: ${results[0].reason?.message || "failed"}`);
  }
  if (results[1].status === "rejected" && hasGoogle) {
    errors.push(`Google: ${results[1].reason?.message || "failed"}`);
  }

  const merged = [
    ...mistralModels.map((id) => `mistral/${id}`),
    ...googleModels.map((id) => `google/${id}`),
  ].sort();

  state.models = merged.length > 0 ? merged : null;
  state.modelsError = errors.length > 0 ? errors.join("; ") : null;

  if (errors.length > 0) {
    state.modelsPromise = null;
  }
};
```

Update `modelsReady` to check either key:

```js
const modelsReady = () => {
  if (!state.modelsPromise) state.modelsPromise = refreshModels();
  return state.modelsPromise;
};
```

Update startup model fetch:

```js
if (state.secrets.hasKey() || state.secrets.hasGoogleKey()) {
  state.modelsPromise = refreshModels();
}
```

Update Controller instantiation:

```js
state.controller = new Controller({
  hotkey: state.hotkey,
  recorder,
  transcribe,
  googleTranscribe,
  summarize,
  googleSummarize,
  typer,
  tray: state.tray,
  getApiKey: () => state.secrets.getKey(),
  getGoogleApiKey: () => state.secrets.getGoogleKey(),
  getConfig: () => state.config,
  notify,
  minDurationMs: 200,
  minHoldMs: 1000,
  sampleRate: 16000,
});
```

Update `settings:get`:

```js
ipcMain.handle("settings:get", async () => {
  if (state.secrets.hasKey() || state.secrets.hasGoogleKey()) await modelsReady();
  return {
    config: state.config,
    hasKey: state.secrets.hasKey(),
    hasGoogleKey: state.secrets.hasGoogleKey(),
    keys: KEYS,
    models: state.models,
    modelsError: state.modelsError,
  };
});
```

Update `settings:save`:

```js
ipcMain.handle("settings:save", async (_e, { config, apiKey, googleApiKey }) => {
  const candidate = configModule.mergeConfig(config);
  const modifierError = configModule.summaryModifierError(
    candidate.recordKey,
    config && config.summaryModifier
  );
  if (modifierError) return { ok: false, error: modifierError };

  // Validate provider/key requirements
  const googleKeyChanged = typeof googleApiKey === "string" && googleApiKey.length > 0;
  const willHaveGoogleKey = googleKeyChanged || state.secrets.hasGoogleKey();
  const needsGoogle = candidate.transcriptionProvider === "google" || candidate.transcriptionProvider === "both";
  if (needsGoogle && !willHaveGoogleKey) {
    return { ok: false, error: "Google API key is required for this transcription provider." };
  }
  if (candidate.summaryModel.startsWith("google/") && !willHaveGoogleKey) {
    return { ok: false, error: "Google API key is required for this summary model." };
  }

  state.config = candidate;
  configModule.saveConfig(configPath, state.config);

  const keyChanged = typeof apiKey === "string" && apiKey.length > 0;
  if (keyChanged) state.secrets.setKey(apiKey);
  if (googleKeyChanged) state.secrets.setGoogleKey(googleApiKey);

  app.setLoginItemSettings({ openAtLogin: state.config.autoLaunch });
  state.hotkey.setBindings({
    recordKey: state.config.recordKey,
    summaryModifier: state.config.summaryModifier,
  });
  state.controller.refreshKeyState();

  if (keyChanged || googleKeyChanged) {
    state.modelsPromise = refreshModels();
    await state.modelsPromise;
  }

  return { ok: true, models: state.models, modelsError: state.modelsError };
});
```

Update the notification for missing keys:

```js
if (!state.secrets.hasKey() && !state.secrets.hasGoogleKey()) {
  notify("VoiceTyper", "Set your API key in Settings (tray icon → Settings).");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/boot.test.js`
Expected: all PASS (both old and new tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/boot.js test/boot.test.js
git commit -m "feat: wire Google modules into boot (dual secrets, dual model fetch, provider validation)"
```

---

### Task 9: Settings UI — Google API key, provider select, merged models

**Files:**
- Modify: `src/settings/settings.html`
- Modify: `src/settings/settings.js`

- [ ] **Step 1: Add Google API key field and provider select to HTML**

In `src/settings/settings.html`, after the Mistral API key label, add:

```html
<label>Google API key
  <input id="googleApiKey" type="password" placeholder="leave blank to keep current key" />
</label>
<label>Transcription provider
  <select id="transcriptionProvider">
    <option value="mistral">Mistral</option>
    <option value="google">Google</option>
    <option value="both">Both (compare)</option>
  </select>
</label>
```

- [ ] **Step 2: Update settings.js — init**

In the `init()` function in `src/settings/settings.js`, after the existing `fillModelSelect` call:

Add to the destructured settings:get result: `hasGoogleKey`

```js
const { config, hasKey, hasGoogleKey, keys, models, modelsError } = await window.settingsAPI.get();
```

Add these lines in init after existing field population:

```js
document.getElementById("transcriptionProvider").value = config.transcriptionProvider || "mistral";
document.getElementById("googleApiKey").placeholder = hasGoogleKey
  ? "leave blank to keep current key"
  : "enter your Google API key";
```

- [ ] **Step 3: Update settings.js — fillModelSelect to show provider labels**

Replace the `fillModelSelect` function:

```js
function fillModelSelect(models, modelsError, saved) {
  const select = document.getElementById("summaryModel");
  const warn = document.getElementById("modelWarn");
  select.replaceChildren();

  const haveModels = Array.isArray(models);
  const options = haveModels && models.length > 0 ? [...models] : [saved];
  if (haveModels && models.length > 0 && !models.includes(saved)) options.unshift(saved);

  for (const id of options) {
    const opt = document.createElement("option");
    opt.value = id;
    // Display: strip prefix, add provider label
    const match = id.match(/^(mistral|google)\/(.*)/);
    opt.textContent = match ? `${match[2]} (${match[1] === "mistral" ? "Mistral" : "Google"})` : id;
    select.appendChild(opt);
  }
  select.value = saved;

  const hasList = haveModels && models.length > 0;
  warn.hidden = hasList;
  if (!hasList) {
    if (modelsError) {
      warn.textContent = `Could not load model list: ${modelsError}`;
    } else if (haveModels) {
      warn.textContent = "No chat-capable models are available on this account.";
    } else {
      warn.textContent = "Could not load model list — save an API key to load it.";
    }
  }
}
```

- [ ] **Step 4: Update settings.js — save handler**

In the save click handler, update the payload:

```js
const payload = {
  config: {
    language: document.getElementById("language").value,
    recordKey: document.getElementById("recordKey").value,
    summaryModifier: document.getElementById("summaryModifier").value,
    summaryModel: document.getElementById("summaryModel").value,
    summaryPrompt: document.getElementById("summaryPrompt").value,
    separator: document.getElementById("separator").value,
    transcriptionProvider: document.getElementById("transcriptionProvider").value,
    micDeviceId: micValue || null,
    autoLaunch: document.getElementById("autoLaunch").checked,
  },
  apiKey: document.getElementById("apiKey").value,
  googleApiKey: document.getElementById("googleApiKey").value,
};
```

After a successful save, also clear the Google key input:

```js
document.getElementById("apiKey").value = "";
document.getElementById("googleApiKey").value = "";
```

- [ ] **Step 5: Manual test**

Run: `npm start`
1. Open Settings from tray
2. Verify the Google API key field appears
3. Verify the Transcription provider dropdown shows Mistral/Google/Both
4. Enter a Google API key and save — verify it persists (placeholder changes)
5. Verify the summary model dropdown shows prefixed models from both providers
6. Select "Google" provider without a Google key — verify error message on save
7. Select "Both" provider with both keys — verify save succeeds

- [ ] **Step 6: Commit**

```bash
git add src/settings/settings.html src/settings/settings.js
git commit -m "feat: settings UI for Google API key, provider select, prefixed model dropdown"
```

---

### Task 10: Update error messages and controller notification

**Files:**
- Modify: `src/main/controller.js`

- [ ] **Step 1: Update `_onStart` to handle missing keys per provider**

In `_onStart()`, replace the single key check:

```js
_onStart() {
  if (this.paused) return;
  const cfg = this.getConfig();
  const provider = cfg.transcriptionProvider || "mistral";
  const needsMistral = provider === "mistral" || provider === "both";
  const needsGoogle = provider === "google" || provider === "both";
  if (needsMistral && !this.getApiKey()) {
    this.notify("VoiceTyper", "Set your Mistral API key in Settings");
    this._setState("error");
    return;
  }
  if (needsGoogle && !this.getGoogleApiKey()) {
    this.notify("VoiceTyper", "Set your Google API key in Settings");
    this._setState("error");
    return;
  }
  if (this.recording) return;
  this.recording = true;
  this.pressedAt = this.now();
  this._setState("recording");
  this.recorder.start();
}
```

Update `_idle` to consider both keys:

```js
_idle() {
  if (this.paused) return this._setState("paused");
  const cfg = this.getConfig();
  const provider = cfg.transcriptionProvider || "mistral";
  const needsMistral = provider === "mistral" || provider === "both";
  const needsGoogle = provider === "google" || provider === "both";
  const hasRequiredKeys =
    (!needsMistral || this.getApiKey()) && (!needsGoogle || this.getGoogleApiKey());
  this._setState(hasRequiredKeys ? "active" : "error");
}
```

- [ ] **Step 2: Update `_errorMessage` for provider-aware messages**

```js
_errorMessage(err) {
  switch (err && err.code) {
    case "NO_API_KEY":
      return err.name === "GoogleError"
        ? "Set your Google API key in Settings"
        : "Set your Mistral API key in Settings";
    case "UNAUTHORIZED":
      return err.name === "GoogleError"
        ? "Invalid Google API key"
        : "Invalid Mistral API key";
    case "RATE_LIMIT":
      return "Rate limited — try again";
    case "NETWORK":
      return "Network error — check your connection";
    default:
      return "Transcription failed";
  }
}
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/controller.js
git commit -m "feat: provider-aware key checks and error messages in controller"
```

---

### Task 11: Full integration test and cleanup

**Files:**
- All test files

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests PASS.

- [ ] **Step 2: Manual end-to-end test**

Run: `npm start`
1. Set Mistral API key → record with Mistral provider → verify transcript types
2. Set Google API key → switch to Google provider → record → verify transcript types
3. Switch to "Both" → record → verify both labeled transcripts appear
4. Switch summary model to a `google/` model → record with summary modifier → verify Gemini summary
5. Remove Google key → try to save with Google provider → verify error
6. Verify existing Mistral-only flow still works unchanged

- [ ] **Step 3: Commit any fixes**

If any tests or manual checks reveal issues, fix and commit.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: integration test fixes for Google provider feature"
```
