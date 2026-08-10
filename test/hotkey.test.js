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
  hk.on("record-start", (payload) => events.push(["start", payload && payload.mode]));
  hk.on("record-stop", () => events.push(["stop"]));
  return events;
}

function make(overrides = {}) {
  const f = fakeListenerFactory();
  const hk = new Hotkey({
    recordKey: "RIGHT ALT",
    summaryKeys: ["LEFT CTRL", "LEFT SHIFT"],
    createListener: f.create,
    ...overrides,
  });
  const events = record(hk);
  hk.start();
  return { f, hk, events };
}

describe("Hotkey", () => {
  it("emits transcript mode once per hold of the record key", () => {
    const h = make();
    h.f.fire("RIGHT ALT", "DOWN");
    h.f.fire("RIGHT ALT", "DOWN"); // auto-repeat, ignored
    h.f.fire("RIGHT ALT", "UP");
    expect(h.events).toEqual([["start", "transcript"], ["stop"]]);
  });

  it("ignores keys that are not bound", () => {
    const h = make();
    h.f.fire("F9", "DOWN");
    expect(h.events).toEqual([]);
  });

  it("starts summary mode only once the second chord key goes down", () => {
    const h = make();
    h.f.fire("LEFT CTRL", "DOWN");
    expect(h.events).toEqual([]);
    h.f.fire("LEFT SHIFT", "DOWN");
    expect(h.events).toEqual([["start", "summary"]]);
  });

  it("stops summary recording when either chord key goes up", () => {
    const first = make();
    first.f.fire("LEFT CTRL", "DOWN");
    first.f.fire("LEFT SHIFT", "DOWN");
    first.f.fire("LEFT CTRL", "UP");
    expect(first.events).toEqual([["start", "summary"], ["stop"]]);

    const second = make();
    second.f.fire("LEFT CTRL", "DOWN");
    second.f.fire("LEFT SHIFT", "DOWN");
    second.f.fire("LEFT SHIFT", "UP");
    expect(second.events).toEqual([["start", "summary"], ["stop"]]);
  });

  it("emits no second stop when the remaining chord key is released", () => {
    const h = make();
    h.f.fire("LEFT CTRL", "DOWN");
    h.f.fire("LEFT SHIFT", "DOWN");
    h.f.fire("LEFT CTRL", "UP");
    h.f.fire("LEFT SHIFT", "UP");
    expect(h.events).toEqual([["start", "summary"], ["stop"]]);
  });

  it("locks the mode: pressing the chord during a transcript hold changes nothing", () => {
    const h = make();
    h.f.fire("RIGHT ALT", "DOWN");
    h.f.fire("LEFT CTRL", "DOWN");
    h.f.fire("LEFT SHIFT", "DOWN");
    expect(h.events).toEqual([["start", "transcript"]]);
    h.f.fire("RIGHT ALT", "UP");
    expect(h.events).toEqual([["start", "transcript"], ["stop"]]);
  });

  it("locks the mode: pressing the record key during a summary hold changes nothing", () => {
    const h = make();
    h.f.fire("LEFT CTRL", "DOWN");
    h.f.fire("LEFT SHIFT", "DOWN");
    h.f.fire("RIGHT ALT", "DOWN");
    expect(h.events).toEqual([["start", "summary"]]);
    h.f.fire("RIGHT ALT", "UP");
    expect(h.events).toEqual([["start", "summary"]]);
  });

  it("starts a fresh summary recording when the chord is re-formed", () => {
    const h = make();
    h.f.fire("LEFT CTRL", "DOWN");
    h.f.fire("LEFT SHIFT", "DOWN");
    h.f.fire("LEFT CTRL", "UP");
    h.f.fire("LEFT CTRL", "DOWN");
    expect(h.events).toEqual([["start", "summary"], ["stop"], ["start", "summary"]]);
  });

  it("treats an empty chord as disabled and leaves the record key working", () => {
    const h = make({ summaryKeys: [] });
    h.f.fire("LEFT CTRL", "DOWN");
    h.f.fire("LEFT SHIFT", "DOWN");
    expect(h.events).toEqual([]);
    h.f.fire("RIGHT ALT", "DOWN");
    expect(h.events).toEqual([["start", "transcript"]]);
  });

  it("passes the bound keys to the listener factory", () => {
    const h = make();
    expect(h.f.state.keys.sort()).toEqual(["LEFT CTRL", "LEFT SHIFT", "RIGHT ALT"].sort());
  });

  it("passes only the record key when the chord is disabled", () => {
    const h = make({ summaryKeys: [] });
    expect(h.f.state.keys).toEqual(["RIGHT ALT"]);
  });

  it("setBindings re-targets the poller and the router", () => {
    const h = make();
    h.hk.setBindings({ recordKey: "F13", summaryKeys: ["F14", "F15"] });

    expect(h.f.state.setKeysCalls.at(-1).sort()).toEqual(["F13", "F14", "F15"].sort());

    h.f.fire("RIGHT ALT", "DOWN");
    expect(h.events).toEqual([]);

    h.f.fire("F14", "DOWN");
    h.f.fire("F15", "DOWN");
    expect(h.events).toEqual([["start", "summary"]]);
  });

  it("setBindings clears a hold in progress without emitting stop", () => {
    const h = make();
    h.f.fire("RIGHT ALT", "DOWN");
    expect(h.events).toEqual([["start", "transcript"]]);

    h.hk.setBindings({ recordKey: "RIGHT ALT", summaryKeys: ["F14", "F15"] });
    h.f.fire("RIGHT ALT", "UP");
    expect(h.events).toEqual([["start", "transcript"]]);

    h.f.fire("RIGHT ALT", "DOWN");
    expect(h.events).toEqual([["start", "transcript"], ["start", "transcript"]]);
  });

  it("normalises lower-case bindings and event names", () => {
    const h = make({ recordKey: "right alt", summaryKeys: ["left ctrl", "left shift"] });
    h.f.fire("right alt", "DOWN");
    expect(h.events).toEqual([["start", "transcript"]]);
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
