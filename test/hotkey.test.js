import { describe, it, expect } from "vitest";
import { Hotkey } from "../src/main/hotkey.js";

function fakeListenerFactory() {
  const state = { cb: null, killed: false, keys: null, setKeysCalls: [] };
  const create = (keys) => {
    state.keys = keys;
    return {
      addListener: (cb) => (state.cb = cb),
      setKeys: (names) => {
        state.keys = names;
        state.setKeysCalls.push(names);
      },
      kill: () => (state.killed = true),
    };
  };
  const fire = (name, keyState) => state.cb({ name, state: keyState });
  return { create, fire, state };
}

function record(hk) {
  const events = [];
  hk.on("record-start", (payload) => events.push(["start", payload]));
  hk.on("record-stop", (payload) => events.push(["stop", payload && payload.mode]));
  return events;
}

function make(overrides = {}) {
  const f = fakeListenerFactory();
  const hk = new Hotkey({
    recordKey: "RIGHT ALT",
    summaryModifier: "RIGHT SHIFT",
    createListener: f.create,
    ...overrides,
  });
  const events = record(hk);
  hk.start();
  return { f, hk, events };
}

describe("Hotkey", () => {
  it("emits a payload-less start and a transcript stop for a plain hold", () => {
    const h = make();
    h.f.fire("RIGHT ALT", "DOWN");
    expect(h.events).toEqual([["start", undefined]]);
    h.f.fire("RIGHT ALT", "UP");
    expect(h.events).toEqual([["start", undefined], ["stop", "transcript"]]);
  });

  it("ignores auto-repeat DOWN on the record key: one start, one stop per hold", () => {
    const h = make();
    h.f.fire("RIGHT ALT", "DOWN");
    h.f.fire("RIGHT ALT", "DOWN"); // auto-repeat, ignored
    h.f.fire("RIGHT ALT", "UP");
    expect(h.events).toEqual([["start", undefined], ["stop", "transcript"]]);
  });

  it("ignores keys that are not bound", () => {
    const h = make();
    h.f.fire("F9", "DOWN");
    expect(h.events).toEqual([]);
  });

  it("upgrades to summary when the modifier is already down before the record key", () => {
    const h = make();
    h.f.fire("RIGHT SHIFT", "DOWN");
    h.f.fire("RIGHT ALT", "DOWN");
    h.f.fire("RIGHT ALT", "UP");
    expect(h.events).toEqual([["start", undefined], ["stop", "summary"]]);
  });

  it("upgrades to summary when the modifier is pressed mid-hold", () => {
    const h = make();
    h.f.fire("RIGHT ALT", "DOWN");
    h.f.fire("RIGHT SHIFT", "DOWN");
    h.f.fire("RIGHT ALT", "UP");
    expect(h.events).toEqual([["start", undefined], ["stop", "summary"]]);
  });

  it("is sticky: releasing the modifier before the record key still yields summary", () => {
    const h = make();
    h.f.fire("RIGHT ALT", "DOWN");
    h.f.fire("RIGHT SHIFT", "DOWN");
    h.f.fire("RIGHT SHIFT", "UP");
    h.f.fire("RIGHT ALT", "UP");
    expect(h.events).toEqual([["start", undefined], ["stop", "summary"]]);
  });

  it("the modifier alone, with no record key, does nothing", () => {
    const h = make();
    h.f.fire("RIGHT SHIFT", "DOWN");
    h.f.fire("RIGHT SHIFT", "UP");
    expect(h.events).toEqual([]);
  });

  it("resets the sticky flag between holds: a later plain hold is transcript again", () => {
    const h = make();
    h.f.fire("RIGHT ALT", "DOWN");
    h.f.fire("RIGHT SHIFT", "DOWN");
    h.f.fire("RIGHT ALT", "UP");
    h.f.fire("RIGHT SHIFT", "UP");
    expect(h.events).toEqual([["start", undefined], ["stop", "summary"]]);

    h.f.fire("RIGHT ALT", "DOWN");
    h.f.fire("RIGHT ALT", "UP");
    expect(h.events).toEqual([
      ["start", undefined],
      ["stop", "summary"],
      ["start", undefined],
      ["stop", "transcript"],
    ]);
  });

  it("treats a disabled modifier (empty string) as always transcript", () => {
    const h = make({ summaryModifier: "" });
    h.f.fire("RIGHT ALT", "DOWN");
    expect(h.events).toEqual([["start", undefined]]);
    h.f.fire("RIGHT ALT", "UP");
    expect(h.events).toEqual([["start", undefined], ["stop", "transcript"]]);
  });

  it("passes the bound keys to the listener factory", () => {
    const h = make();
    expect(h.f.state.keys.sort()).toEqual(["RIGHT ALT", "RIGHT SHIFT"].sort());
  });

  it("passes only the record key when the modifier is disabled", () => {
    const h = make({ summaryModifier: "" });
    expect(h.f.state.keys).toEqual(["RIGHT ALT"]);
  });

  it("setBindings re-targets the poller and the router", () => {
    const h = make();
    h.hk.setBindings({ recordKey: "F13", summaryModifier: "F14" });

    expect(h.f.state.setKeysCalls.at(-1).sort()).toEqual(["F13", "F14"].sort());

    h.f.fire("RIGHT ALT", "DOWN");
    expect(h.events).toEqual([]);

    h.f.fire("F14", "DOWN");
    h.f.fire("F13", "DOWN");
    h.f.fire("F13", "UP");
    expect(h.events).toEqual([["start", undefined], ["stop", "summary"]]);
  });

  it("setBindings clears a hold in progress without emitting stop, and resets the sticky flag", () => {
    const h = make();
    h.f.fire("RIGHT ALT", "DOWN");
    expect(h.events).toEqual([["start", undefined]]);

    h.hk.setBindings({ recordKey: "RIGHT ALT", summaryModifier: "F14" });
    h.f.fire("RIGHT ALT", "UP");
    expect(h.events).toEqual([["start", undefined]]);

    h.f.fire("RIGHT ALT", "DOWN");
    h.f.fire("RIGHT ALT", "UP");
    expect(h.events).toEqual([
      ["start", undefined],
      ["start", undefined],
      ["stop", "transcript"],
    ]);
  });

  it("normalises lower-case bindings and event names", () => {
    const h = make({ recordKey: "right alt", summaryModifier: "right shift" });
    h.f.fire("right alt", "DOWN");
    h.f.fire("right shift", "DOWN");
    h.f.fire("right alt", "UP");
    expect(h.events).toEqual([["start", undefined], ["stop", "summary"]]);
  });

  it("ignores a malformed event and an unknown state", () => {
    const h = make();
    expect(() => h.f.fire(undefined, "DOWN")).not.toThrow();
    h.f.fire("RIGHT ALT", "REPEAT");
    expect(h.events).toEqual([]);
  });

  it("stop kills the listener", () => {
    const h = make();
    h.hk.stop();
    expect(h.f.state.killed).toBe(true);
  });
});
