import { describe, it, expect } from "vitest";
import { createTyper, sanitize, separatorText } from "../src/main/typer.js";

const Key = { LeftShift: "LeftShift", Return: "Return" };

// The typer hands nut-js one character at a time (so it can check the
// modifier keys in between). Adjacent characters are merged here so the
// expectations read as the text that reaches the focused field.
function fakeKeyboard() {
  const calls = [];
  return {
    calls,
    keyboard: {
      type: async (t) => {
        const last = calls[calls.length - 1];
        if (last && last[0] === "type") last[1] += t;
        else calls.push(["type", t]);
      },
      pressKey: async (...k) => calls.push(["press", ...k]),
      releaseKey: async (...k) => calls.push(["release", ...k]),
    },
  };
}

function make(opts = {}) {
  const f = fakeKeyboard();
  return { f, typer: createTyper({ keyboard: f.keyboard, Key, ...opts }) };
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

  it("types single-line text without pressing any key", async () => {
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

describe("typer modifier guard", () => {
  it("types each character separately so a modifier is checked in between", async () => {
    const singles = [];
    const typer = createTyper({
      keyboard: { type: async (t) => singles.push(t), pressKey: async () => {}, releaseKey: async () => {} },
      Key,
    });
    await typer.type("äb c");
    expect(singles).toEqual(["ä", "b", " ", "c"]);
  });

  it("waits while a modifier is down and resumes after it is released", async () => {
    let downChecks = 3;
    const sleeps = [];
    const { f, typer } = make({
      isModifierDown: () => downChecks-- > 0,
      sleep: async (ms) => sleeps.push(ms),
      pollMs: 15,
    });
    await typer.type("hi");
    expect(f.calls).toEqual([["type", "hi"]]);
    expect(sleeps).toEqual([15, 15, 15]);
  });

  it("stops before a character when a modifier goes down mid-text", async () => {
    let typedCount = 0;
    const order = [];
    const typer = createTyper({
      keyboard: {
        type: async (t) => {
          typedCount++;
          order.push(t);
        },
        pressKey: async () => {},
        releaseKey: async () => {},
      },
      Key,
      // AltGr goes down after the second character and is released after two polls.
      isModifierDown: (() => {
        let polls = 0;
        return () => typedCount === 2 && polls++ < 2;
      })(),
      sleep: async () => order.push("wait"),
    });
    await typer.type("abcd");
    expect(order).toEqual(["a", "b", "wait", "wait", "c", "d"]);
  });

  it("checks the modifiers before a soft newline as well", async () => {
    let held = true;
    const { f, typer } = make({
      isModifierDown: () => held,
      sleep: async () => {
        held = false;
      },
    });
    await typer.type("\n");
    expect(f.calls).toEqual([
      ["press", "LeftShift", "Return"],
      ["release", "LeftShift", "Return"],
    ]);
  });

  it("gives up after the timeout and reports the untyped rest", async () => {
    let typedCount = 0;
    const { f, typer } = make({
      isModifierDown: () => typedCount >= 2,
      sleep: async () => {},
      modifierTimeoutMs: 30,
      pollMs: 10,
    });
    const keyboard = f.keyboard;
    const original = keyboard.type;
    keyboard.type = async (t) => {
      typedCount++;
      await original(t);
    };
    const err = await typer.type("abcdef").catch((e) => e);
    expect(err.code).toBe("MODIFIER_HELD");
    expect(err.remaining).toBe("cdef");
    expect(f.calls).toEqual([["type", "ab"]]);
  });

  it("does not time out while a dictation hold is active", async () => {
    let polls = 0;
    const { f, typer } = make({
      isModifierDown: () => polls < 50,
      isHoldActive: () => true,
      sleep: async () => {
        polls++;
      },
      modifierTimeoutMs: 30,
      pollMs: 10,
    });
    await typer.type("ok");
    expect(f.calls).toEqual([["type", "ok"]]);
  });
});

describe("sanitize", () => {
  it("drops control characters that would act as keystrokes", () => {
    expect(sanitize("a\u0008b\u001bc\u007fd\u0085e")).toBe("abcde");
  });

  it("turns a tab into a space and normalises newlines", () => {
    expect(sanitize("a\tb\r\nc\rd")).toBe("a b\nc\nd");
  });

  it("drops characters outside the Basic Multilingual Plane", () => {
    expect(sanitize("ok 👍 fine")).toBe("ok  fine");
  });

  it("drops lone surrogates", () => {
    expect(sanitize("a\uD83Db")).toBe("ab");
  });

  it("keeps umlauts, accents and typographic punctuation", () => {
    expect(sanitize("Grüße — «café» €5")).toBe("Grüße — «café» €5");
  });
});

describe("separatorText", () => {
  it("maps every separator to the text typed between parts", () => {
    expect(separatorText("blank-line")).toBe("\n\n");
    expect(separatorText("dash")).toBe(" — ");
    expect(separatorText("spaces")).toBe("  ");
    expect(separatorText("toString")).toBe("\n\n");
  });
});
