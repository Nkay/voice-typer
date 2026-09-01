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
