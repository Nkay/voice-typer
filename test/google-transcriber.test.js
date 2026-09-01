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
