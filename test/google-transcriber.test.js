import { describe, it, expect } from "vitest";
import { transcribe, INTERACTIONS_ENDPOINT } from "../src/shared/google-transcriber.js";

const wav = new Uint8Array(44 + 2);

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// The shape confirmed against the live Interactions API: the transcript lives in
// steps[type=model_output].content[type=text].text. There is no top-level
// output_text field in the REST response — that is an SDK-only convenience.
function interaction(text) {
  return {
    id: "v1_abc",
    status: "completed",
    steps: [{ type: "model_output", content: [{ type: "text", text }] }],
  };
}

describe("google transcribe", () => {
  it("throws NO_API_KEY when key is missing", async () => {
    await expect(transcribe(wav, { apiKey: "" })).rejects.toMatchObject({ code: "NO_API_KEY" });
  });

  it("sends the audio inline as base64 in a single interactions request", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, interaction("hallo welt"));
    };

    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252]);
    const text = await transcribe(bytes, { apiKey: "k", fetchImpl });

    expect(text).toBe("hallo welt");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(INTERACTIONS_ENDPOINT);
    expect(calls[0].init.headers["x-goog-api-key"]).toBe("k");

    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe("gemini-3.5-transcribe");
    expect(body.input).toHaveLength(1);
    expect(body.input[0].type).toBe("audio");
    expect(body.input[0].mime_type).toBe("audio/wav");
    expect(body.input[0].data).toBe(Buffer.from(bytes).toString("base64"));
    // Nothing may be left referencing a file: the Files API is not in this path.
    expect(body.input[0].uri).toBeUndefined();
  });

  // Regression guard for the doubled-/v1beta upload URL that made every Google
  // transcription 404: the Files API must not be contacted at all.
  it("never contacts the Files API", async () => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      return jsonResponse(200, interaction("ok"));
    };
    await transcribe(wav, { apiKey: "k", fetchImpl });
    expect(urls.some((u) => u.includes("/upload"))).toBe(false);
    expect(urls.some((u) => u.includes("/files"))).toBe(false);
    expect(urls.every((u) => !u.includes("/v1beta/upload"))).toBe(true);
  });

  it("sends the endpoint exactly once with no doubled version segment", async () => {
    expect(INTERACTIONS_ENDPOINT).toBe(
      "https://generativelanguage.googleapis.com/v1beta/interactions"
    );
    expect(INTERACTIONS_ENDPOINT.match(/v1beta/g)).toHaveLength(1);
  });

  it("passes language_codes when a language is pinned", async () => {
    let body;
    const fetchImpl = async (_url, init) => {
      body = JSON.parse(init.body);
      return jsonResponse(200, interaction("ok"));
    };
    await transcribe(wav, { apiKey: "k", language: "de", fetchImpl });
    expect(body.generation_config.transcription_config).toEqual({
      mode: "smart",
      language_codes: ["de"],
    });
  });

  it("omits language_codes on auto-detect", async () => {
    let body;
    const fetchImpl = async (_url, init) => {
      body = JSON.parse(init.body);
      return jsonResponse(200, interaction("ok"));
    };
    await transcribe(wav, { apiKey: "k", language: "auto", fetchImpl });
    expect(body.generation_config.transcription_config).toEqual({ mode: "smart" });
  });

  it("joins multiple text blocks and ignores non-text content", async () => {
    const fetchImpl = async () =>
      jsonResponse(200, {
        steps: [
          { type: "thought", content: [{ type: "text", text: "ignore me" }] },
          {
            type: "model_output",
            content: [
              { type: "text", text: "erste " },
              { type: "audio", data: "ignored" },
              { type: "text", text: "zweite" },
            ],
          },
        ],
      });
    const text = await transcribe(wav, { apiKey: "k", fetchImpl });
    expect(text).toBe("erste zweite");
  });

  it("maps 401 to UNAUTHORIZED", async () => {
    const fetchImpl = async () => jsonResponse(401, {});
    await expect(transcribe(wav, { apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("maps a 400 API_KEY_INVALID to UNAUTHORIZED", async () => {
    const fetchImpl = async () =>
      jsonResponse(400, {
        error: {
          code: 400,
          message: "API key not valid. Please pass a valid API key.",
          status: "INVALID_ARGUMENT",
          details: [{ reason: "API_KEY_INVALID" }],
        },
      });
    await expect(transcribe(wav, { apiKey: "wrong", fetchImpl })).rejects.toMatchObject({
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
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) throw new Error("ECONNRESET");
      return jsonResponse(200, interaction("ok"));
    };
    const text = await transcribe(wav, { apiKey: "k", fetchImpl, maxAttempts: 2 });
    expect(text).toBe("ok");
    expect(calls).toBe(2);
  });

  it("throws NETWORK after exhausting attempts", async () => {
    const fetchImpl = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(
      transcribe(wav, { apiKey: "k", fetchImpl, maxAttempts: 2 })
    ).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("throws BAD_RESPONSE when the response carries no model output", async () => {
    const fetchImpl = async () => jsonResponse(200, { id: "x", status: "completed", steps: [] });
    await expect(transcribe(wav, { apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("throws BAD_RESPONSE for malformed JSON", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    });
    await expect(transcribe(wav, { apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  // Inline audio is bounded by the API's request-size limit, so an over-long
  // dictation must fail with something the user can act on rather than an
  // opaque 400 from Google.
  it("throws TOO_LARGE before sending an over-long recording", async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return jsonResponse(200, interaction("ok"));
    };
    const huge = new Uint8Array(15 * 1024 * 1024);
    await expect(transcribe(huge, { apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "TOO_LARGE",
    });
    expect(called).toBe(false);
  });
});
