import { describe, it, expect } from "vitest";
import EventEmitter from "events";
import { openStream } from "../src/shared/microsoft-streamer.js";

const DELTA = "conversation.item.input_audio_transcription.delta";
const INTERMEDIATE = "conversation.item.input_audio_transcription.intermediate";
const COMPLETED = "conversation.item.input_audio_transcription.completed";

// Stands in for the ws package: records what the client sends and lets the test
// play the server.
function fakeSocketClass() {
  const sockets = [];
  class FakeSocket extends EventEmitter {
    constructor(url, options) {
      super();
      this.url = url;
      this.options = options;
      this.sent = [];
      this.closed = false;
      sockets.push(this);
    }
    send(data) {
      if (this.closed) throw new Error("socket closed");
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.closed = true;
    }
    server(event) {
      this.emit("message", Buffer.from(JSON.stringify(event), "utf8"));
    }
    ofType(type) {
      return this.sent.filter((e) => e.type === type);
    }
  }
  return { FakeSocket, sockets };
}

// Timers that only fire when the test says so.
function manualTimers() {
  const pending = new Map();
  let seq = 0;
  return {
    setTimeout: (fn, ms) => {
      const id = ++seq;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => pending.delete(id),
    fireAll() {
      for (const [id, t] of [...pending]) {
        pending.delete(id);
        t.fn();
      }
    },
    count: () => pending.size,
  };
}

function open(overrides = {}) {
  const { FakeSocket, sockets } = fakeSocketClass();
  const timers = manualTimers();
  const deltas = [];
  const stream = openStream({
    apiKey: "ms-key",
    endpoint: "https://res.services.ai.azure.com",
    WebSocketImpl: FakeSocket,
    timers,
    onDelta: (d) => deltas.push(d),
    ...overrides,
  });
  return { stream, ws: sockets[0], timers, deltas };
}

function startSession(ws) {
  ws.server({ type: "session.created", session: { id: "s1" } });
  ws.server({ type: "session.updated", session: { id: "s1" } });
}

describe("openStream", () => {
  it("connects to the realtime URL with the key in a header", () => {
    const { ws } = open();
    expect(ws.url).toBe("wss://res.services.ai.azure.com/mai/v1/realtime?intent=transcription");
    expect(ws.options.headers).toEqual({ "api-key": "ms-key" });
  });

  it("configures a transcription session after session.created", () => {
    const { ws } = open({ deployment: "my-deploy", language: "de" });
    expect(ws.sent).toEqual([]);
    ws.server({ type: "session.created" });
    expect(ws.sent).toEqual([
      {
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 16000 },
              transcription: { model: "my-deploy", language: "de" },
              turn_detection: null,
              noise_reduction: null,
            },
          },
        },
      },
    ]);
  });

  it("leaves the language out for auto-detection, because the service rejects null", () => {
    const { ws } = open({ language: "auto" });
    ws.server({ type: "session.created" });
    expect(ws.sent[0].session.audio.input.transcription).toEqual({ model: "MAI-Transcribe-2-Streaming" });
  });

  it("holds audio until the session is configured, then sends it in order", () => {
    const { stream, ws } = open();
    stream.append(new Uint8Array([1, 2]));
    stream.append(new Uint8Array([3, 4]));
    ws.server({ type: "session.created" });
    expect(ws.ofType("input_audio_buffer.append")).toEqual([]);
    ws.server({ type: "session.updated" });
    const appends = ws.ofType("input_audio_buffer.append").map((e) => e.audio);
    expect(appends).toEqual([Buffer.from([1, 2]).toString("base64"), Buffer.from([3, 4]).toString("base64")]);
  });

  it("forwards finalised deltas and ignores intermediate hypotheses", () => {
    const { ws, deltas } = open();
    startSession(ws);
    ws.server({ type: DELTA, delta: "Hallo" });
    ws.server({ type: INTERMEDIATE, intermediate: " Welt" });
    ws.server({ type: DELTA, delta: " Welt!" });
    expect(deltas).toEqual(["Hallo", " Welt!"]);
  });

  it("commits on finish and resolves with the completed transcript", async () => {
    const { stream, ws } = open();
    startSession(ws);
    stream.append(new Uint8Array([1, 2]));
    const done = stream.finish();
    expect(ws.ofType("input_audio_buffer.commit")).toHaveLength(1);
    ws.server({ type: "input_audio_buffer.committed" });
    ws.server({ type: COMPLETED, transcript: "Hallo Welt" });
    await expect(done).resolves.toBe("Hallo Welt");
    expect(ws.closed).toBe(true);
  });

  it("falls back to the accumulated deltas when completed has no transcript", async () => {
    const { stream, ws } = open();
    startSession(ws);
    stream.append(new Uint8Array([1, 2]));
    ws.server({ type: DELTA, delta: "a" });
    ws.server({ type: DELTA, delta: "b" });
    const done = stream.finish();
    ws.server({ type: COMPLETED });
    await expect(done).resolves.toBe("ab");
  });

  it("ignores a completed event that arrives before the commit", async () => {
    const { stream, ws } = open();
    startSession(ws);
    stream.append(new Uint8Array([1, 2]));
    ws.server({ type: COMPLETED, transcript: "early" });
    const done = stream.finish();
    ws.server({ type: COMPLETED, transcript: "final" });
    await expect(done).resolves.toBe("final");
  });

  it("commits once the session is ready when finish comes first", async () => {
    const { stream, ws } = open();
    stream.append(new Uint8Array([1, 2]));
    const done = stream.finish();
    expect(ws.ofType("input_audio_buffer.commit")).toEqual([]);
    startSession(ws);
    const types = ws.sent.map((e) => e.type);
    expect(types).toEqual(["session.update", "input_audio_buffer.append", "input_audio_buffer.commit"]);
    ws.server({ type: COMPLETED, transcript: "x" });
    await expect(done).resolves.toBe("x");
  });

  it("resolves with an empty transcript when no audio was sent", async () => {
    const { stream, ws } = open();
    startSession(ws);
    await expect(stream.finish()).resolves.toBe("");
    expect(ws.ofType("input_audio_buffer.commit")).toEqual([]);
  });

  it("drops audio appended after the commit", () => {
    const { stream, ws } = open();
    startSession(ws);
    stream.append(new Uint8Array([1]));
    stream.finish();
    stream.append(new Uint8Array([2]));
    expect(ws.ofType("input_audio_buffer.append")).toHaveLength(1);
  });

  it("rejects with UNAUTHORIZED when the handshake answers 401", async () => {
    const { stream, ws } = open();
    let destroyed = false;
    ws.emit("unexpected-response", { destroy: () => (destroyed = true) }, { statusCode: 401 });
    const err = await stream.finish().catch((e) => e);
    expect(err.name).toBe("MicrosoftError");
    expect(err.code).toBe("UNAUTHORIZED");
    expect(destroyed).toBe(true);
  });

  it("rejects with the mapped server error", async () => {
    const { stream, ws } = open();
    startSession(ws);
    ws.server({ type: "error", error: { code: "invalid_api_key", message: "nope" } });
    const err = await stream.finish().catch((e) => e);
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("rejects with NETWORK when the socket errors or closes early", async () => {
    const a = open();
    a.ws.emit("error", new Error("ECONNRESET"));
    expect((await a.stream.finish().catch((e) => e)).code).toBe("NETWORK");

    const b = open();
    startSession(b.ws);
    b.ws.emit("close", 1006);
    expect((await b.stream.finish().catch((e) => e)).code).toBe("NETWORK");
  });

  it("rejects with BAD_RESPONSE on a malformed message", async () => {
    const { stream, ws } = open();
    ws.emit("message", Buffer.from("{not json"));
    expect((await stream.finish().catch((e) => e)).code).toBe("BAD_RESPONSE");
  });

  it("parses a message with multi-byte characters", () => {
    const { ws, deltas } = open();
    startSession(ws);
    ws.server({ type: DELTA, delta: "Grüße €" });
    expect(deltas).toEqual(["Grüße €"]);
  });

  it("rejects with TIMEOUT when the session never starts", async () => {
    const { stream, timers } = open();
    timers.fireAll();
    expect((await stream.finish().catch((e) => e)).code).toBe("TIMEOUT");
  });

  it("rejects with TIMEOUT when the final transcript never arrives", async () => {
    const { stream, ws, timers } = open();
    startSession(ws);
    stream.append(new Uint8Array([1]));
    const done = stream.finish();
    timers.fireAll();
    expect((await done.catch((e) => e)).code).toBe("TIMEOUT");
  });

  it("does not report a failure during the hold as unhandled", async () => {
    const { ws } = open();
    ws.emit("error", new Error("boom"));
    // Without finish() ever being called, the rejection must stay handled.
    await new Promise((r) => setTimeout(r, 0));
  });

  it("cancel resolves empty, closes the socket and ignores later events", async () => {
    const { stream, ws, deltas } = open();
    startSession(ws);
    stream.cancel();
    expect(ws.closed).toBe(true);
    await expect(stream.finish()).resolves.toBe("");
    stream.append(new Uint8Array([1]));
    expect(ws.ofType("input_audio_buffer.append")).toEqual([]);
    ws.emit("close", 1000);
    expect(deltas).toEqual([]);
  });

  it("clears its timers once settled", async () => {
    const { stream, ws, timers } = open();
    startSession(ws);
    stream.append(new Uint8Array([1]));
    const done = stream.finish();
    ws.server({ type: COMPLETED, transcript: "x" });
    await done;
    expect(timers.count()).toBe(0);
  });

  it("throws NO_API_KEY without a key and NO_ENDPOINT without an endpoint", () => {
    const { FakeSocket } = fakeSocketClass();
    expect(() => openStream({ endpoint: "https://res.services.ai.azure.com", WebSocketImpl: FakeSocket })).toThrow(
      expect.objectContaining({ code: "NO_API_KEY" })
    );
    expect(() => openStream({ apiKey: "k", endpoint: "", WebSocketImpl: FakeSocket })).toThrow(
      expect.objectContaining({ code: "NO_ENDPOINT" })
    );
  });

  it("keeps going when the delta callback throws", () => {
    const { ws } = open({
      onDelta: () => {
        throw new Error("typer exploded");
      },
    });
    startSession(ws);
    expect(() => ws.server({ type: DELTA, delta: "x" })).not.toThrow();
  });
});
