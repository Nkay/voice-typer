import { describe, it, expect } from "vitest";
import { GEMINI_API_BASE, GoogleError, errorForStatus, fetchWithTimeout } from "../src/shared/google.js";

describe("google shared", () => {
  it("exposes the v1beta API base", () => {
    expect(GEMINI_API_BASE).toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  it("carries a code on the error", () => {
    const err = new GoogleError("NOPE", "nope");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("GoogleError");
    expect(err.code).toBe("NOPE");
    expect(err.message).toBe("nope");
  });

  it("maps statuses to codes", () => {
    expect(errorForStatus(401).code).toBe("UNAUTHORIZED");
    expect(errorForStatus(403).code).toBe("UNAUTHORIZED");
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
