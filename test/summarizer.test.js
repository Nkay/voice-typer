import { describe, it, expect } from "vitest";
import { summarize, CHAT_ENDPOINT } from "../src/shared/summarizer.js";

function chatResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function okResponse(content) {
  return chatResponse(200, { choices: [{ message: { content } }] });
}

describe("summarize", () => {
  it("throws NO_API_KEY when the key is missing", async () => {
    await expect(summarize("hallo", { apiKey: "" })).rejects.toMatchObject({ code: "NO_API_KEY" });
  });

  it("throws NO_TRANSCRIPT for empty input", async () => {
    await expect(summarize("   ", { apiKey: "k" })).rejects.toMatchObject({
      code: "NO_TRANSCRIPT",
    });
  });

  it("posts the prompt as system and the transcript as user, returning trimmed content", async () => {
    let captured;
    const fetchImpl = async (url, init) => {
      captured = { url, init };
      return okResponse("  short summary  ");
    };
    const out = await summarize("a long transcript", {
      apiKey: "k",
      model: "mistral-large-latest",
      prompt: "Be terse.",
      fetchImpl,
    });

    expect(out).toBe("short summary");
    expect(captured.url).toBe(CHAT_ENDPOINT);
    expect(captured.url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(captured.init.method).toBe("POST");
    expect(captured.init.headers.Authorization).toBe("Bearer k");
    expect(captured.init.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(captured.init.body);
    expect(body.model).toBe("mistral-large-latest");
    expect(body.messages).toEqual([
      { role: "system", content: "Be terse." },
      { role: "user", content: "a long transcript" },
    ]);
  });

  it("defaults to mistral-small-latest", async () => {
    let body;
    const fetchImpl = async (_url, init) => {
      body = JSON.parse(init.body);
      return okResponse("s");
    };
    await summarize("t", { apiKey: "k", fetchImpl });
    expect(body.model).toBe("mistral-small-latest");
  });

  it("maps 401 to UNAUTHORIZED and 429 to RATE_LIMIT without retrying", async () => {
    let calls = 0;
    const unauthorized = async () => {
      calls++;
      return chatResponse(401, {});
    };
    await expect(summarize("t", { apiKey: "k", fetchImpl: unauthorized })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(calls).toBe(1);

    await expect(
      summarize("t", { apiKey: "k", fetchImpl: async () => chatResponse(429, {}) })
    ).rejects.toMatchObject({ code: "RATE_LIMIT" });
  });

  it("maps other non-2xx statuses to HTTP", async () => {
    await expect(
      summarize("t", { apiKey: "k", fetchImpl: async () => chatResponse(422, {}) })
    ).rejects.toMatchObject({ code: "HTTP" });
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
    const fetchImpl = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(
      summarize("t", { apiKey: "k", fetchImpl, maxAttempts: 2 })
    ).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("maps an unparseable body to BAD_RESPONSE", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    });
    await expect(summarize("t", { apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("maps a missing or blank choice to BAD_RESPONSE", async () => {
    await expect(
      summarize("t", { apiKey: "k", fetchImpl: async () => chatResponse(200, { choices: [] }) })
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });

    await expect(
      summarize("t", { apiKey: "k", fetchImpl: async () => okResponse("   ") })
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });

    await expect(
      summarize("t", { apiKey: "k", fetchImpl: async () => chatResponse(200, {}) })
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
});
