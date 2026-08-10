import { describe, it, expect } from "vitest";
import { fetchChatModels, MODELS_ENDPOINT } from "../src/shared/models.js";

function listResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const SAMPLE = {
  data: [
    { id: "mistral-small-latest", capabilities: { completion_chat: true } },
    { id: "voxtral-mini-latest", capabilities: { completion_chat: false, audio: true } },
    { id: "mistral-large-latest", capabilities: { completion_chat: true } },
    { id: "mistral-embed", capabilities: {} },
    { id: "codestral-latest", capabilities: { completion_chat: true } },
  ],
};

describe("fetchChatModels", () => {
  it("throws NO_API_KEY when the key is missing", async () => {
    await expect(fetchChatModels({ apiKey: "" })).rejects.toMatchObject({ code: "NO_API_KEY" });
  });

  it("returns only chat-capable ids, sorted", async () => {
    let captured;
    const fetchImpl = async (url, init) => {
      captured = { url, init };
      return listResponse(200, SAMPLE);
    };
    const ids = await fetchChatModels({ apiKey: "k", fetchImpl });

    expect(ids).toEqual(["codestral-latest", "mistral-large-latest", "mistral-small-latest"]);
    expect(captured.url).toBe(MODELS_ENDPOINT);
    expect(captured.url).toBe("https://api.mistral.ai/v1/models");
    expect(captured.init.headers.Authorization).toBe("Bearer k");
  });

  it("de-duplicates repeated ids", async () => {
    const body = {
      data: [
        { id: "mistral-small-latest", capabilities: { completion_chat: true } },
        { id: "mistral-small-latest", capabilities: { completion_chat: true } },
      ],
    };
    const ids = await fetchChatModels({ apiKey: "k", fetchImpl: async () => listResponse(200, body) });
    expect(ids).toEqual(["mistral-small-latest"]);
  });

  it("maps 401 to UNAUTHORIZED", async () => {
    await expect(
      fetchChatModels({ apiKey: "k", fetchImpl: async () => listResponse(401, {}) })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("maps a network failure to NETWORK without retrying", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      throw new Error("ENOTFOUND");
    };
    await expect(fetchChatModels({ apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "NETWORK",
    });
    expect(calls).toBe(1);
  });

  it("maps an unparseable body to BAD_RESPONSE", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    });
    await expect(fetchChatModels({ apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("maps a body without a data array to BAD_RESPONSE", async () => {
    await expect(
      fetchChatModels({ apiKey: "k", fetchImpl: async () => listResponse(200, { data: "nope" }) })
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("returns an empty array when no model is chat-capable", async () => {
    const body = { data: [{ id: "voxtral-mini-latest", capabilities: { completion_chat: false } }] };
    const ids = await fetchChatModels({ apiKey: "k", fetchImpl: async () => listResponse(200, body) });
    expect(ids).toEqual([]);
  });
});
