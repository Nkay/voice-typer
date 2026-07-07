import { describe, it, expect } from "vitest";
import { Hotkey } from "../src/main/hotkey.js";

function fakeListenerFactory() {
  const state = { cb: null, killed: false };
  const create = () => ({
    addListener: (cb) => (state.cb = cb),
    kill: () => (state.killed = true),
  });
  const fire = (name, keyState) => state.cb({ name, state: keyState });
  return { create, fire, state };
}

describe("Hotkey", () => {
  it("emits record-start once per hold and record-stop on release", () => {
    const f = fakeListenerFactory();
    const hk = new Hotkey({ keyName: "RIGHT ALT", createListener: f.create });
    const events = [];
    hk.on("record-start", () => events.push("start"));
    hk.on("record-stop", () => events.push("stop"));
    hk.start();

    f.fire("RIGHT ALT", "DOWN");
    f.fire("RIGHT ALT", "DOWN"); // auto-repeat, ignored
    f.fire("RIGHT ALT", "UP");
    expect(events).toEqual(["start", "stop"]);
  });

  it("ignores other keys", () => {
    const f = fakeListenerFactory();
    const hk = new Hotkey({ keyName: "RIGHT ALT", createListener: f.create });
    const events = [];
    hk.on("record-start", () => events.push("start"));
    hk.start();
    f.fire("SPACE", "DOWN");
    expect(events).toEqual([]);
  });

  it("setKey changes which key triggers", () => {
    const f = fakeListenerFactory();
    const hk = new Hotkey({ keyName: "RIGHT ALT", createListener: f.create });
    const events = [];
    hk.on("record-start", () => events.push("start"));
    hk.start();
    hk.setKey("LEFT CTRL");
    f.fire("LEFT CTRL", "DOWN");
    expect(events).toEqual(["start"]);
  });
});
