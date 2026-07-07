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
    Key: { Enter: "ENTER" },
  };
}

describe("typer", () => {
  it("types text then presses Enter", async () => {
    const f = fakeKeyboard();
    const typer = createTyper({ keyboard: f.keyboard, Key: f.Key });
    await typer.typeAndEnter("hallo");
    expect(f.calls).toEqual([
      ["type", "hallo"],
      ["press", "ENTER"],
      ["release", "ENTER"],
    ]);
  });

  it("does nothing for empty text", async () => {
    const f = fakeKeyboard();
    const typer = createTyper({ keyboard: f.keyboard, Key: f.Key });
    await typer.typeAndEnter("");
    expect(f.calls).toEqual([]);
  });
});
