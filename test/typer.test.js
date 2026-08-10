import { describe, it, expect } from "vitest";
import { createTyper } from "../src/main/typer.js";

const Key = { LeftShift: "LeftShift", Return: "Return" };

function fakeKeyboard() {
  const calls = [];
  return {
    calls,
    keyboard: {
      type: async (t) => calls.push(["type", t]),
      pressKey: async (...k) => calls.push(["press", ...k]),
      releaseKey: async (...k) => calls.push(["release", ...k]),
    },
  };
}

function make() {
  const f = fakeKeyboard();
  return { f, typer: createTyper({ keyboard: f.keyboard, Key }) };
}

describe("typer", () => {
  it("types the text and presses no keys", async () => {
    const { f, typer } = make();
    await typer.type("hallo");
    expect(f.calls).toEqual([["type", "hallo"]]);
  });

  it("does nothing for empty text", async () => {
    const { f, typer } = make();
    await typer.type("");
    expect(f.calls).toEqual([]);
  });

  it("still produces exactly one keyboard.type call for single-line text", async () => {
    const { f, typer } = make();
    await typer.type("hello world");
    expect(f.calls).toEqual([["type", "hello world"]]);
  });

  it("turns an embedded newline into a soft newline instead of a raw \\n", async () => {
    const { f, typer } = make();
    await typer.type("line one\nline two");
    expect(f.calls).toEqual([
      ["type", "line one"],
      ["press", "LeftShift", "Return"],
      ["release", "LeftShift", "Return"],
      ["type", "line two"],
    ]);
  });

  it("turns a double newline into two soft-newline pairs", async () => {
    const { f, typer } = make();
    await typer.type("a\n\nb");
    expect(f.calls).toEqual([
      ["type", "a"],
      ["press", "LeftShift", "Return"],
      ["release", "LeftShift", "Return"],
      ["press", "LeftShift", "Return"],
      ["release", "LeftShift", "Return"],
      ["type", "b"],
    ]);
  });

  it("does not emit a stray empty type call for a trailing newline", async () => {
    const { f, typer } = make();
    await typer.type("only line\n");
    expect(f.calls).toEqual([
      ["type", "only line"],
      ["press", "LeftShift", "Return"],
      ["release", "LeftShift", "Return"],
    ]);
  });

  it("never hands keyboard.type a value containing a raw newline", async () => {
    const { f, typer } = make();
    await typer.type("a\nb\r\nc\rd\n\ne");
    const typed = f.calls.filter((c) => c[0] === "type").map((c) => c[1]);
    expect(typed.length).toBeGreaterThan(0);
    for (const t of typed) {
      expect(t).not.toMatch(/\r|\n/);
    }
  });
});

describe("typer.typeParts", () => {
  it("separates with two Shift+Enter presses by default", async () => {
    const { f, typer } = make();
    await typer.typeParts(["transcript", "summary"]);
    expect(f.calls).toEqual([
      ["type", "transcript"],
      ["press", "LeftShift", "Return"],
      ["release", "LeftShift", "Return"],
      ["press", "LeftShift", "Return"],
      ["release", "LeftShift", "Return"],
      ["type", "summary"],
    ]);
  });

  it("never types a raw newline in blank-line mode", async () => {
    const { f, typer } = make();
    await typer.typeParts(["a", "b"], "blank-line");
    const typed = f.calls.filter((c) => c[0] === "type").map((c) => c[1]);
    expect(typed.some((t) => t.includes("\n"))).toBe(false);
  });

  it("joins with an em dash in one call for the dash separator", async () => {
    const { f, typer } = make();
    await typer.typeParts(["transcript", "summary"], "dash");
    expect(f.calls).toEqual([["type", "transcript — summary"]]);
  });

  it("joins with two spaces in one call for the spaces separator", async () => {
    const { f, typer } = make();
    await typer.typeParts(["transcript", "summary"], "spaces");
    expect(f.calls).toEqual([["type", "transcript  summary"]]);
  });

  it("falls back to blank-line for an unknown separator", async () => {
    const { f, typer } = make();
    await typer.typeParts(["a", "b"], "pipe");
    expect(f.calls).toEqual([
      ["type", "a"],
      ["press", "LeftShift", "Return"],
      ["release", "LeftShift", "Return"],
      ["press", "LeftShift", "Return"],
      ["release", "LeftShift", "Return"],
      ["type", "b"],
    ]);
  });

  it("presses nothing for a single part", async () => {
    const { f, typer } = make();
    await typer.typeParts(["only"]);
    expect(f.calls).toEqual([["type", "only"]]);
  });

  it("drops empty and non-string parts", async () => {
    const { f, typer } = make();
    await typer.typeParts(["a", "", null, "b"], "dash");
    expect(f.calls).toEqual([["type", "a — b"]]);
  });

  it("does nothing when every part is empty", async () => {
    const { f, typer } = make();
    await typer.typeParts(["", null], "dash");
    expect(f.calls).toEqual([]);
  });

  it("does nothing for a non-array argument", async () => {
    const { f, typer } = make();
    await typer.typeParts(undefined);
    expect(f.calls).toEqual([]);
  });

  it("emits exactly N-1 separators for N parts", async () => {
    const { f, typer } = make();
    await typer.typeParts(["a", "b", "c"]);
    const separators = f.calls.filter((c) => c[0] === "press").length;
    expect(separators).toBe(4); // Two Shift+Enter pairs (press/release) between a-b and b-c
  });

  it("never types a raw newline in unknown-separator fallback", async () => {
    const { f, typer } = make();
    await typer.typeParts(["a", "b"], "pipe");
    const typed = f.calls.filter((c) => c[0] === "type").map((c) => c[1]);
    expect(typed.some((t) => t.includes("\n"))).toBe(false);
  });

  it("rejects inherited properties: constructor falls back to blank-line", async () => {
    const { f, typer } = make();
    await typer.typeParts(["a", "b"], "constructor");
    expect(f.calls).toEqual([
      ["type", "a"],
      ["press", "LeftShift", "Return"],
      ["release", "LeftShift", "Return"],
      ["press", "LeftShift", "Return"],
      ["release", "LeftShift", "Return"],
      ["type", "b"],
    ]);
  });

  it("rejects inherited properties: __proto__ falls back to blank-line", async () => {
    const { f, typer } = make();
    await typer.typeParts(["a", "b"], "__proto__");
    expect(f.calls).toEqual([
      ["type", "a"],
      ["press", "LeftShift", "Return"],
      ["release", "LeftShift", "Return"],
      ["press", "LeftShift", "Return"],
      ["release", "LeftShift", "Return"],
      ["type", "b"],
    ]);
  });

  it("rejects inherited properties: toString falls back to blank-line", async () => {
    const { f, typer } = make();
    await typer.typeParts(["a", "b"], "toString");
    expect(f.calls).toEqual([
      ["type", "a"],
      ["press", "LeftShift", "Return"],
      ["release", "LeftShift", "Return"],
      ["press", "LeftShift", "Return"],
      ["release", "LeftShift", "Return"],
      ["type", "b"],
    ]);
  });
});
