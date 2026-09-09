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

  // A wrong Google key answers 400/INVALID_ARGUMENT, not 401 — verified against
  // the live API. Without reading the body a typo'd key reads as a generic
  // failure, which tells the user nothing about what to fix.
  it("recognises an invalid API key behind a 400", () => {
    const body = {
      error: {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        status: "INVALID_ARGUMENT",
        details: [{ reason: "API_KEY_INVALID", domain: "googleapis.com" }],
      },
    };
    const err = errorForStatus(400, body);
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.message).toMatch(/Google API key/i);
  });

  // /interactions returns its errors wrapped in an array, /models does not.
  // Verified against the live API — the array shape is what the transcription
  // path actually receives.
  it("recognises an invalid API key inside an array-wrapped error body", () => {
    const body = [
      {
        error: {
          code: 400,
          message: "API key not valid. Please pass a valid API key.",
          status: "INVALID_ARGUMENT",
          details: [{ reason: "API_KEY_INVALID" }],
        },
      },
    ];
    expect(errorForStatus(400, body).code).toBe("UNAUTHORIZED");
  });

  it("leaves other 400s as generic HTTP errors", () => {
    const body = {
      error: { code: 400, message: "Invalid enum value 'nonsense'", status: "INVALID_ARGUMENT" },
    };
    expect(errorForStatus(400, body).code).toBe("HTTP");
    expect(errorForStatus(400, null).code).toBe("HTTP");
    expect(errorForStatus(400).code).toBe("HTTP");
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
