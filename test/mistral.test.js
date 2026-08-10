import { describe, it, expect } from "vitest";
import { API_BASE, MistralError, errorForStatus, fetchWithTimeout } from "../src/shared/mistral.js";

describe("mistral shared", () => {
  it("exposes the v1 API base", () => {
    expect(API_BASE).toBe("https://api.mistral.ai/v1");
  });

  it("carries a code on the error", () => {
    const err = new MistralError("NOPE", "nope");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("NOPE");
    expect(err.message).toBe("nope");
  });

  it("maps statuses to codes", () => {
    expect(errorForStatus(401).code).toBe("UNAUTHORIZED");
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
