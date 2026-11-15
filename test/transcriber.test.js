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

describe("transcribe with dictionary hints", () => {
  it("sends one context_bias field per hint", async () => {
    let form;
    const fetchImpl = async (_url, init) => {
      form = init.body;
      return jsonResponse(200, { text: "ok" });
    };
    await transcribe(wav, { apiKey: "k", fetchImpl, hints: ["chax", "Voice Typer"] });
    expect(form.getAll("context_bias")).toEqual(["chax", "Voice Typer"]);
  });

  it("sends no context_bias without hints", async () => {
    let form;
    const fetchImpl = async (_url, init) => {
      form = init.body;
      return jsonResponse(200, { text: "ok" });
    };
    await transcribe(wav, { apiKey: "k", fetchImpl });
    expect(form.has("context_bias")).toBe(false);
  });

  it("tries once more without hints when the API rejects them with 400", async () => {
    const forms = [];
    const fetchImpl = async (_url, init) => {
      forms.push(init.body);
      return forms.length === 1 ? jsonResponse(400, {}) : jsonResponse(200, { text: "ok" });
    };
    expect(await transcribe(wav, { apiKey: "k", fetchImpl, hints: ["chax"], maxAttempts: 1 })).toBe("ok");
    expect(forms).toHaveLength(2);
    expect(forms[1].has("context_bias")).toBe(false);
  });

  it("does not retry a 400 without hints", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return jsonResponse(400, {});
    };
    await expect(transcribe(wav, { apiKey: "k", fetchImpl })).rejects.toMatchObject({ code: "HTTP" });
    expect(calls).toBe(1);
  });
});
