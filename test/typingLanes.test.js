import { describe, it, expect } from "vitest";
import { createTypingLanes } from "../src/main/typingLanes.js";
import { TyperError } from "../src/main/typer.js";

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("typing lanes", () => {
  it("types the texts of one lane in order", async () => {
    const typed = [];
    const lanes = createTypingLanes({ type: async (t) => typed.push(t) });
    const lane = lanes.open();
    lane.push("a");
    lane.push("b");
    await lane.close();
    expect(typed).toEqual(["a", "b"]);
  });

  it("does not start a later lane before the earlier one closes", async () => {
    const typed = [];
    const lanes = createTypingLanes({ type: async (t) => typed.push(t) });
    const first = lanes.open();
    const second = lanes.open();
    first.push("1a");
    second.push("2a");
    await tick();
    expect(typed).toEqual(["1a"]);
    first.push("1b");
    await first.close();
    await second.close();
    expect(typed).toEqual(["1a", "1b", "2a"]);
  });

  it("waits for a slow type call before the next text", async () => {
    const typed = [];
    const gate = deferred();
    const lanes = createTypingLanes({
      type: async (t) => {
        if (t === "slow") await gate.promise;
        typed.push(t);
      },
    });
    const lane = lanes.open();
    lane.push("slow");
    lane.push("next");
    await tick();
    expect(typed).toEqual([]);
    gate.resolve();
    await lane.close();
    expect(typed).toEqual(["slow", "next"]);
  });

  it("discard drops untyped text and lets the next lane run", async () => {
    const typed = [];
    const lanes = createTypingLanes({ type: async (t) => typed.push(t) });
    const first = lanes.open();
    const second = lanes.open();
    second.push("kept");
    await first.discard();
    await second.close();
    expect(typed).toEqual(["kept"]);
  });

  it("diverts the rest of a lane when a modifier stays down", async () => {
    const typed = [];
    const diverted = [];
    const lanes = createTypingLanes({
      type: async (t) => {
        if (t === "blocked text") throw new TyperError("MODIFIER_HELD", "held", "ked text");
        typed.push(t);
      },
      onDiverted: (t) => diverted.push(t),
    });
    const lane = lanes.open();
    lane.push("ok ");
    lane.push("blocked text");
    lane.push(" and more");
    await lane.close();
    expect(typed).toEqual(["ok "]);
    expect(diverted).toEqual(["ked text and more"]);
  });

  it("reports other typing errors and keeps typing", async () => {
    const typed = [];
    const errors = [];
    const lanes = createTypingLanes({
      type: async (t) => {
        if (t === "bad") throw new Error("nut-js failed");
        typed.push(t);
      },
      onError: (e) => errors.push(e.message),
    });
    const lane = lanes.open();
    lane.push("bad");
    lane.push("good");
    await lane.close();
    expect(errors).toEqual(["nut-js failed"]);
    expect(typed).toEqual(["good"]);
  });

  it("ignores empty texts and pushes after close", async () => {
    const typed = [];
    const lanes = createTypingLanes({ type: async (t) => typed.push(t) });
    const lane = lanes.open();
    lane.push("");
    lane.push(null);
    await lane.close();
    lane.push("late");
    await tick();
    expect(typed).toEqual([]);
  });
});
