import { describe, it, expect } from "vitest";
import { transcribe, TranscriberError } from "../src/shared/transcriber.js";

const wav = new Uint8Array(44 + 2);

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("transcribe", () => {
  it("throws NO_API_KEY when key is missing", async () => {
    await expect(transcribe(wav, { apiKey: "" })).rejects.toMatchObject({ code: "NO_API_KEY" });
  });

  it("posts to the Voxtral endpoint and returns trimmed text", async () => {
    let captured;
    const fetchImpl = async (url, init) => {
      captured = { url, init };
      return jsonResponse(200, { text: "  hallo welt  " });
    };
    const text = await transcribe(wav, { apiKey: "k", language: "de", fetchImpl });
    expect(text).toBe("hallo welt");
    expect(captured.url).toBe("https://api.mistral.ai/v1/audio/transcriptions");
    expect(captured.init.headers.Authorization).toBe("Bearer k");
  });

  it("maps 401 to UNAUTHORIZED", async () => {
    const fetchImpl = async () => jsonResponse(401, {});
    await expect(transcribe(wav, { apiKey: "k", fetchImpl })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("maps 429 to RATE_LIMIT", async () => {
    const fetchImpl = async () => jsonResponse(429, {});
    await expect(transcribe(wav, { apiKey: "k", fetchImpl })).rejects.toMatchObject({ code: "RATE_LIMIT" });
  });

  it("retries once on network error then succeeds", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) throw new Error("ECONNRESET");
      return jsonResponse(200, { text: "ok" });
    };
    const text = await transcribe(wav, { apiKey: "k", fetchImpl, maxAttempts: 2 });
    expect(text).toBe("ok");
    expect(calls).toBe(2);
  });

  it("maps a malformed 2xx body to BAD_RESPONSE", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    });
    await expect(transcribe(wav, { apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });
});
