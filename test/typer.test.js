import { describe, it, expect } from "vitest";
import { createTyper } from "../src/main/typer.js";

const Key = { LeftShift: "LeftShift", Enter: "Enter" };

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
});

describe("typer.typeParts", () => {
  it("separates with two Shift+Enter presses by default", async () => {
    const { f, typer } = make();
    await typer.typeParts(["transcript", "summary"]);
    expect(f.calls).toEqual([
      ["type", "transcript"],
      ["press", "LeftShift", "Enter"],
      ["release", "LeftShift", "Enter"],
      ["press", "LeftShift", "Enter"],
      ["release", "LeftShift", "Enter"],
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
      ["press", "LeftShift", "Enter"],
      ["release", "LeftShift", "Enter"],
      ["press", "LeftShift", "Enter"],
      ["release", "LeftShift", "Enter"],
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
      ["press", "LeftShift", "Enter"],
      ["release", "LeftShift", "Enter"],
      ["press", "LeftShift", "Enter"],
      ["release", "LeftShift", "Enter"],
      ["type", "b"],
    ]);
  });

  it("rejects inherited properties: __proto__ falls back to blank-line", async () => {
    const { f, typer } = make();
    await typer.typeParts(["a", "b"], "__proto__");
    expect(f.calls).toEqual([
      ["type", "a"],
      ["press", "LeftShift", "Enter"],
      ["release", "LeftShift", "Enter"],
      ["press", "LeftShift", "Enter"],
      ["release", "LeftShift", "Enter"],
      ["type", "b"],
    ]);
  });

  it("rejects inherited properties: toString falls back to blank-line", async () => {
    const { f, typer } = make();
    await typer.typeParts(["a", "b"], "toString");
    expect(f.calls).toEqual([
      ["type", "a"],
      ["press", "LeftShift", "Enter"],
      ["release", "LeftShift", "Enter"],
      ["press", "LeftShift", "Enter"],
      ["release", "LeftShift", "Enter"],
      ["type", "b"],
    ]);
  });
});
