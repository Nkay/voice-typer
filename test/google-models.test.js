import { describe, it, expect } from "vitest";
import { fetchGeminiModels } from "../src/shared/google-models.js";

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
