import { describe, it, expect } from "vitest";
import {
  MicrosoftError,
  normalizeEndpoint,
  realtimeUrl,
  errorForStatus,
  errorForEvent,
} from "../src/shared/microsoft.js";

describe("normalizeEndpoint", () => {
  it("keeps a resource root URL", () => {
    expect(normalizeEndpoint("https://my-res.services.ai.azure.com")).toBe(
      "https://my-res.services.ai.azure.com"
    );
  });

  it("drops a trailing slash and surrounding whitespace", () => {
    expect(normalizeEndpoint("  https://my-res.services.ai.azure.com/ ")).toBe(
      "https://my-res.services.ai.azure.com"
    );
  });

  it("adds https:// to a bare host", () => {
    expect(normalizeEndpoint("my-res.services.ai.azure.com")).toBe("https://my-res.services.ai.azure.com");
  });

  it("accepts a wss:// root and stores it as https://", () => {
    expect(normalizeEndpoint("wss://my-res.services.ai.azure.com")).toBe("https://my-res.services.ai.azure.com");
  });

  it("reduces a Foundry project endpoint to its resource root", () => {
    expect(normalizeEndpoint("https://voice-typer-resource.services.ai.azure.com/api/projects/voice-typer")).toBe(
      "https://voice-typer-resource.services.ai.azure.com"
    );
    expect(normalizeEndpoint("https://res.services.ai.azure.com/api/projects/p1/")).toBe(
      "https://res.services.ai.azure.com"
    );
  });

  it("rejects a project path with extra segments", () => {
    expect(normalizeEndpoint("https://res.services.ai.azure.com/api/projects/p1/models")).toBe("");
    expect(normalizeEndpoint("https://res.services.ai.azure.com/api/projects/")).toBe("");
  });

  it("rejects a URL with a path, query or credentials", () => {
    expect(normalizeEndpoint("https://my-res.services.ai.azure.com/mai/v1/realtime")).toBe("");
    expect(normalizeEndpoint("https://my-res.services.ai.azure.com/?api-key=x")).toBe("");
    expect(normalizeEndpoint("https://user:pw@my-res.services.ai.azure.com")).toBe("");
  });

  it("rejects plain http, junk and non-strings", () => {
    expect(normalizeEndpoint("http://my-res.services.ai.azure.com")).toBe("");
    expect(normalizeEndpoint("not a url")).toBe("");
    expect(normalizeEndpoint("localhost")).toBe("");
    expect(normalizeEndpoint("")).toBe("");
    expect(normalizeEndpoint(null)).toBe("");
  });
});

describe("realtimeUrl", () => {
  it("builds the transcription WebSocket URL", () => {
    expect(realtimeUrl("https://my-res.services.ai.azure.com/")).toBe(
      "wss://my-res.services.ai.azure.com/mai/v1/realtime?intent=transcription"
    );
  });

  it("throws NO_ENDPOINT for an unusable endpoint", () => {
    expect(() => realtimeUrl("")).toThrow(MicrosoftError);
    try {
      realtimeUrl("nope");
    } catch (err) {
      expect(err.code).toBe("NO_ENDPOINT");
    }
  });
});

describe("errorForStatus", () => {
  it("maps handshake statuses to codes", () => {
    expect(errorForStatus(401).code).toBe("UNAUTHORIZED");
    expect(errorForStatus(403).code).toBe("UNAUTHORIZED");
    expect(errorForStatus(404).code).toBe("NOT_FOUND");
    expect(errorForStatus(429).code).toBe("RATE_LIMIT");
    expect(errorForStatus(500).code).toBe("HTTP");
  });
});

describe("errorForEvent", () => {
  it("recognises an authentication error", () => {
    const err = errorForEvent({ type: "error", error: { code: "invalid_api_key", message: "bad key" } });
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("recognises a rate limit", () => {
    expect(errorForEvent({ type: "error", error: { code: "rate_limit_exceeded" } }).code).toBe("RATE_LIMIT");
  });

  it("recognises a missing deployment", () => {
    expect(errorForEvent({ type: "error", error: { code: "DeploymentNotFound" } }).code).toBe("NOT_FOUND");
  });

  it("treats the PCM-rate complaint of an unknown deployment as not found", () => {
    const err = errorForEvent({
      type: "error",
      error: { message: "PCM input rate must be 24000, or 16000 for MAI transcription." },
    });
    expect(err.code).toBe("NOT_FOUND");
  });

  it("keeps the server message for anything else", () => {
    const err = errorForEvent({ type: "error", error: { code: "invalid_value", message: "bad audio" } });
    expect(err.code).toBe("SERVER");
    expect(err.message).toBe("bad audio");
  });

  it("survives an event without an error body", () => {
    expect(errorForEvent({ type: "error" }).code).toBe("SERVER");
  });
});
