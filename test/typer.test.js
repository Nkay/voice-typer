import { describe, it, expect } from "vitest";
import { createTyper } from "../src/main/typer.js";

function fakeKeyboard() {
  const calls = [];
  return {
    calls,
    keyboard: {
      type: async (t) => calls.push(["type", t]),
      pressKey: async (k) => calls.push(["press", k]),
      releaseKey: async (k) => calls.push(["release", k]),
    },
  };
}

describe("typer", () => {
  it("types the text and presses no keys", async () => {
    const f = fakeKeyboard();
    const typer = createTyper({ keyboard: f.keyboard });
    await typer.type("hallo");
    expect(f.calls).toEqual([["type", "hallo"]]);
  });

  it("does nothing for empty text", async () => {
    const f = fakeKeyboard();
    const typer = createTyper({ keyboard: f.keyboard });
    await typer.type("");
    expect(f.calls).toEqual([]);
  });
});
