import { describe, it, expect } from "vitest";
import { streamText } from "../src/shared/sse.js";

// A response whose body sends `chunks` one by one, each after `gapMs`.
function chunked(chunks, gapMs = 0) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        for (const chunk of chunks) {
          if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { status: 200 }
  );
}

const deltaOf = (data) => (data === "[DONE]" ? "" : data);

describe("streamText", () => {
  it("joins lines split across chunks, also a CRLF split between \\r and \\n, and a last line without newline", async () => {
    const pieces = [];
    const { text } = await streamText("u", {}, {
      fetchImpl: async () => chunked(["data: Hel", "lo\r", "\n\r\ndata: , ", "\n: comment\ndata: world"]),
      deltaOf,
      onDelta: (d) => pieces.push(d),
    });

    expect(pieces).toEqual(["Hello", ",", "world"]);
    expect(text).toBe("Hello,world");
  });

  it("gives back a refused response unread", async () => {
    const { res } = await streamText("u", {}, {
      fetchImpl: async () => new Response('{"error":"bad key"}', { status: 400 }),
      deltaOf,
      onDelta: () => {},
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad key" });
  });

  it("stops a stream that stays silent longer than the timeout after its first chunk", async () => {
    let signal;
    const fetchImpl = async (_url, init) => {
      signal = init.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("data: Hi\n"));
            signal.addEventListener("abort", () => controller.error(new Error("aborted")));
          },
        }),
        { status: 200 }
      );
    };

    await expect(streamText("u", {}, { fetchImpl, timeoutMs: 30, deltaOf, onDelta: () => {} })).rejects.toThrow();
    expect(signal.aborted).toBe(true);
  });

  it("lets a stream take longer than the timeout when its chunks keep coming", async () => {
    const { text } = await streamText("u", {}, {
      fetchImpl: async () => chunked(["data: a\n", "data: b\n", "data: c\n", "data: d\n"], 20),
      timeoutMs: 50,
      deltaOf,
      onDelta: () => {},
    });

    expect(text).toBe("abcd");
  });

  it("stops the request when onDelta throws, and passes that error on", async () => {
    let signal;
    const stop = new Error("too long");
    const fetchImpl = async (_url, init) => {
      signal = init.signal;
      return chunked(["data: a\n", "data: b\n"]);
    };

    await expect(
      streamText("u", {}, {
        fetchImpl,
        deltaOf,
        onDelta: () => {
          throw stop;
        },
      })
    ).rejects.toMatchObject({ message: "too long", fromCaller: true });
    expect(signal.aborted).toBe(true);
  });
});
