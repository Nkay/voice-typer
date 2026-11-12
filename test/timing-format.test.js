import { describe, it, expect } from "vitest";
import { describeTiming } from "../src/shared/timing-format.js";

const base = (extra = {}) => ({
  at: 1000,
  mode: "transcript",
  live: false,
  recordMs: 6400,
  audioMs: 80,
  queueMs: 0,
  models: [{ label: "Mistral", ms: 1210, status: "ok", typed: true }],
  summaryMs: null,
  summaryFailed: false,
  typingMs: 2550,
  chars: 412,
  totalMs: 3900,
  ...extra,
});

const row = (view, label) => view.rows.find((r) => r.label === label);

describe("describeTiming", () => {
  it("gives the time of the dictation and a one-line summary", () => {
    const view = describeTiming(base());

    expect(view.at).toBe(1000);
    expect(view.summary).toBe("recorded 6.4 s · typing finished 3.9 s after release");
  });

  it("lists each step in the order it happens, in seconds", () => {
    const view = describeTiming(base());

    expect(view.rows.map((r) => [r.label, r.value, r.note])).toEqual([
      ["audio ready", "0.08 s", ""],
      ["queue wait", "0.00 s", ""],
      ["Mistral", "1.21 s", "typed"],
      ["typing", "2.55 s", "412 characters"],
    ]);
  });

  it("explains what each model did", () => {
    const view = describeTiming(
      base({
        models: [
          { label: "Mistral", ms: 1210, status: "ok", typed: true },
          { label: "Google", ms: 2900, status: "ok", typed: false },
          { label: "Microsoft", ms: 10000, status: "failed", error: "TIMEOUT", typed: false },
          { label: "Microsoft (live)", ms: 700, status: "empty", typed: false },
          { label: "Slow", ms: null, status: "pending", typed: false },
          { label: "Lost", ms: null, status: "unfinished", typed: false },
        ],
      })
    );

    expect(row(view, "Mistral").note).toBe("typed");
    expect(row(view, "Google").note).toBe("answered later");
    expect([row(view, "Microsoft").value, row(view, "Microsoft").note]).toEqual(["10.00 s", "failed (TIMEOUT)"]);
    expect(row(view, "Microsoft (live)").note).toBe("heard nothing");
    expect([row(view, "Slow").value, row(view, "Slow").note]).toEqual(["…", "no answer yet"]);
    expect([row(view, "Lost").value, row(view, "Lost").note]).toEqual(["–", "no answer"]);
  });

  it("says which model is the primary", () => {
    const view = describeTiming(
      base({
        models: [
          { label: "Mistral", ms: null, status: "pending", typed: false, primary: true },
          { label: "Google", ms: 1000, status: "ok", typed: true },
        ],
      })
    );

    expect(row(view, "Mistral").note).toBe("primary, no answer yet");
    expect(row(view, "Google").note).toBe("typed");
  });

  it("shows the wait for the primary after the models", () => {
    expect(row(describeTiming(base()), "wait for primary")).toBeUndefined();

    const view = describeTiming(
      base({
        models: [
          { label: "Mistral", ms: 2400, status: "ok", typed: false, primary: true },
          { label: "Google", ms: 1000, status: "ok", typed: true },
        ],
        primaryWaitMs: 500,
      })
    );

    expect(view.rows.map((r) => [r.label, r.value, r.note])).toEqual([
      ["audio ready", "0.08 s", ""],
      ["queue wait", "0.00 s", ""],
      ["Mistral", "2.40 s", "primary, answered later"],
      ["Google", "1.00 s", "typed"],
      ["wait for primary", "0.50 s", ""],
      ["typing", "2.55 s", "412 characters"],
    ]);
  });

  it("shows the summary step only for a dictation with a summary", () => {
    expect(row(describeTiming(base()), "summary")).toBeUndefined();

    const view = describeTiming(base({ mode: "summary", summaryMs: 1800 }));

    expect([row(view, "summary").value, row(view, "summary").note]).toEqual(["1.80 s", ""]);
    expect(view.rows.map((r) => r.label)).toEqual(["audio ready", "queue wait", "Mistral", "summary", "typing"]);
  });

  it("says when the summary failed", () => {
    const view = describeTiming(base({ mode: "summary", summaryMs: 10000, summaryFailed: true }));

    expect(row(view, "summary").note).toBe("failed");
  });

  it("leaves the typing step out when nothing was typed", () => {
    const view = describeTiming(
      base({ models: [{ label: "Mistral", ms: 10000, status: "failed", error: "TIMEOUT", typed: false }], typingMs: null, chars: 0 })
    );

    expect(row(view, "typing")).toBeUndefined();
    expect(view.summary).toBe("recorded 6.4 s · nothing typed, ended 3.9 s after release");
  });

  it("names the typing step of a live dictation for what it measures", () => {
    const view = describeTiming(
      base({ live: true, models: [{ label: "Microsoft (live)", ms: 300, status: "ok", typed: true }], typingMs: 120 })
    );

    expect(row(view, "typing")).toBeUndefined();
    expect(row(view, "typing after the last answer").note).toBe("412 characters in total, typed live");
  });

  it("marks the slowest step on the way to the typed text", () => {
    const view = describeTiming(
      base({
        models: [
          { label: "Mistral", ms: 1210, status: "ok", typed: true },
          // Slower, but the text did not wait for it.
          { label: "Google", ms: 9000, status: "ok", typed: false },
        ],
      })
    );

    expect(view.rows.filter((r) => r.slowest).map((r) => r.label)).toEqual(["typing"]);
  });

  it("marks the slowest model when no model gave a text", () => {
    const view = describeTiming(
      base({
        models: [
          { label: "Mistral", ms: 400, status: "empty", typed: false },
          { label: "Google", ms: 10000, status: "failed", error: "TIMEOUT", typed: false },
        ],
        typingMs: null,
        chars: 0,
      })
    );

    expect(view.rows.filter((r) => r.slowest).map((r) => r.label)).toEqual(["Google"]);
  });
});
