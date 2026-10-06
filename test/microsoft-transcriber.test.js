import { describe, it, expect } from "vitest";
import { transcribe } from "../src/shared/microsoft-transcriber.js";

const wav = new Uint8Array(44 + 2);
const endpoint = "https://res.services.ai.azure.com";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("Microsoft transcribe", () => {
  it("throws NO_API_KEY or NO_ENDPOINT when either is missing", async () => {
    await expect(transcribe(wav, { apiKey: "", endpoint })).rejects.toMatchObject({ code: "NO_API_KEY" });
    await expect(transcribe(wav, { apiKey: "k", endpoint: "" })).rejects.toMatchObject({ code: "NO_ENDPOINT" });
  });

  it("posts to the Speech host of the resource and returns the combined text", async () => {
    let captured;
    const fetchImpl = async (url, init) => {
      captured = { url, init };
      return jsonResponse(200, { combinedPhrases: [{ text: " Hallo Welt " }] });
    };
    const text = await transcribe(wav, { apiKey: "k", endpoint, language: "de", fetchImpl });
    expect(text).toBe("Hallo Welt");
    expect(captured.url).toBe(
      "https://res.cognitiveservices.azure.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15"
    );
    expect(captured.init.headers["Ocp-Apim-Subscription-Key"]).toBe("k");
    expect(JSON.parse(captured.init.body.get("definition"))).toEqual({
      enhancedMode: { enabled: true, model: "MAI-Transcribe-2" },
      locales: ["de"],
    });
    expect(captured.init.body.get("audio")).toBeInstanceOf(Blob);
  });

  it("leaves the locale out for auto-detection", async () => {
    let definition;
    const fetchImpl = async (url, init) => {
      definition = JSON.parse(init.body.get("definition"));
      return jsonResponse(200, { combinedPhrases: [] });
    };
    expect(await transcribe(wav, { apiKey: "k", endpoint, fetchImpl })).toBe("");
    expect("locales" in definition).toBe(false);
  });

  it("maps HTTP errors and network failures", async () => {
    await expect(
      transcribe(wav, { apiKey: "k", endpoint, fetchImpl: async () => jsonResponse(401, {}) })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", name: "MicrosoftError" });
    await expect(
      transcribe(wav, {
        apiKey: "k",
        endpoint,
        fetchImpl: async () => {
          throw new Error("ECONNRESET");
        },
      })
    ).rejects.toMatchObject({ code: "NETWORK" });
  });
});
