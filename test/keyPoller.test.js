import { describe, it, expect, vi } from "vitest";
import { createKeyPoller } from "../src/main/keyPoller.js";
import { KEY_NAMES, vkFor } from "../src/shared/keys.js";

const VK = { "RIGHT ALT": 0xa5, "LEFT ALT": 0xa4, "RIGHT CTRL": 0xa3, "LEFT CTRL": 0xa2 };

function harness(opts = {}) {
  const pressed = new Set();
  const cleared = [];
  let tickFn = null;
  let capturedMs = null;
  const timers = {
    setInterval: (fn, ms) => {
      tickFn = fn;
      capturedMs = ms;
      return "timer-handle";
    },
    clearInterval: (handle) => cleared.push(handle),
  };
  const poller = createKeyPoller({
    getKeyState: (vk) => pressed.has(vk),
    timers,
    ...opts,
  });
  const events = [];
  poller.addListener((e) => events.push(e));
  return { pressed, tick: () => tickFn(), events, poller, cleared, capturedMs: () => capturedMs };
}

describe("createKeyPoller", () => {
  it("emits DOWN once on a rising edge", () => {
    const h = harness();
    h.pressed.add(VK["RIGHT ALT"]);
    h.tick();
    h.tick();
    expect(h.events).toEqual([{ name: "RIGHT ALT", state: "DOWN" }]);
  });

  it("emits UP once on a falling edge", () => {
    const h = harness();
    h.pressed.add(VK["LEFT CTRL"]);
    h.tick();
    h.pressed.delete(VK["LEFT CTRL"]);
    h.tick();
    h.tick();
    expect(h.events).toEqual([
      { name: "LEFT CTRL", state: "DOWN" },
      { name: "LEFT CTRL", state: "UP" },
    ]);
  });

  it("emits nothing while no key state changes", () => {
    const h = harness();
    h.tick();
    h.tick();
    expect(h.events).toEqual([]);
  });

  it("tracks multiple keys independently", () => {
    const h = harness();
    h.pressed.add(VK["RIGHT ALT"]).add(VK["LEFT ALT"]);
    h.tick();
    const names = h.events.map((e) => e.name).sort();
    expect(names).toEqual(["LEFT ALT", "RIGHT ALT"]);
    expect(h.events.every((e) => e.state === "DOWN")).toBe(true);
  });

  it("kill() stops the poll timer", () => {
    const h = harness();
    h.poller.kill();
    expect(h.cleared).toEqual(["timer-handle"]);
  });

  it("defaults to a 30ms interval", () => {
    const h = harness();
    expect(h.capturedMs()).toBe(30);
  });

  it("delivers an event to every registered listener", () => {
    const h = harness();
    const events2 = [];
    h.poller.addListener((e) => events2.push(e));

    h.pressed.add(VK["RIGHT ALT"]);
    h.tick();

    expect(h.events).toEqual([{ name: "RIGHT ALT", state: "DOWN" }]);
    expect(events2).toEqual([{ name: "RIGHT ALT", state: "DOWN" }]);
  });

  it("isolates a throwing listener so later listeners still run, and the next tick still works", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const pressed = new Set();
    let tickFn = null;
    const timers = {
      setInterval: (fn) => {
        tickFn = fn;
        return "timer-handle";
      },
      clearInterval: () => {},
    };
    const poller = createKeyPoller({ getKeyState: (vk) => pressed.has(vk), timers });
    const boom = new Error("boom");
    poller.addListener(() => {
      throw boom;
    });
    const events = [];
    poller.addListener((e) => events.push(e));

    pressed.add(VK["RIGHT ALT"]);
    expect(() => tickFn()).not.toThrow();

    expect(events).toEqual([{ name: "RIGHT ALT", state: "DOWN" }]);
    expect(consoleError).toHaveBeenCalledWith("VoiceTyper: hotkey listener callback failed", boom);

    pressed.delete(VK["RIGHT ALT"]);
    expect(() => tickFn()).not.toThrow();

    expect(events).toEqual([
      { name: "RIGHT ALT", state: "DOWN" },
      { name: "RIGHT ALT", state: "UP" },
    ]);

    consoleError.mockRestore();
  });

  it("polls only the watched keys", () => {
    const polled = [];
    const h = harness({ keys: ["LEFT CTRL", "LEFT SHIFT"], getKeyState: (vk) => {
      polled.push(vk);
      return false;
    } });
    h.tick();
    expect(polled.sort()).toEqual([vkFor("LEFT SHIFT"), vkFor("LEFT CTRL")].sort());
  });

  it("emits nothing for a key outside the watch list", () => {
    const h = harness({ keys: ["LEFT CTRL"] });
    h.pressed.add(VK["RIGHT ALT"]);
    h.tick();
    expect(h.events).toEqual([]);
  });

  it("defaults to watching the whole catalog", () => {
    const polled = [];
    const h = harness({ getKeyState: (vk) => {
      polled.push(vk);
      return false;
    } });
    h.tick();
    expect(polled.length).toBe(KEY_NAMES.length);
  });

  it("setKeys re-targets which keys are polled", () => {
    const h = harness({ keys: ["LEFT CTRL"] });
    h.poller.setKeys(["RIGHT ALT"]);
    h.pressed.add(VK["RIGHT ALT"]);
    h.tick();
    expect(h.events).toEqual([{ name: "RIGHT ALT", state: "DOWN" }]);

    h.pressed.add(VK["LEFT CTRL"]);
    h.tick();
    expect(h.events).toEqual([{ name: "RIGHT ALT", state: "DOWN" }]);
  });

  it("setKeys drops the down-state of removed keys without emitting UP", () => {
    const h = harness({ keys: ["LEFT CTRL"] });
    h.pressed.add(VK["LEFT CTRL"]);
    h.tick();
    expect(h.events).toEqual([{ name: "LEFT CTRL", state: "DOWN" }]);

    h.poller.setKeys(["RIGHT ALT"]);
    h.pressed.delete(VK["LEFT CTRL"]);
    h.tick();
    expect(h.events).toEqual([{ name: "LEFT CTRL", state: "DOWN" }]);
  });

  it("ignores unknown key names and de-duplicates repeats", () => {
    const polled = [];
    const h = harness({ keys: ["LEFT CTRL", "NOT A KEY", "LEFT CTRL"], getKeyState: (vk) => {
      polled.push(vk);
      return false;
    } });
    h.tick();
    expect(polled).toEqual([vkFor("LEFT CTRL")]);
  });

  it("re-emits DOWN after a key is removed from and returned to the watch list", () => {
    const h = harness({ keys: ["LEFT CTRL"] });
    h.pressed.add(VK["LEFT CTRL"]);
    h.tick();
    h.poller.setKeys(["RIGHT ALT"]);
    h.tick();
    h.poller.setKeys(["LEFT CTRL"]);
    h.tick();
    expect(h.events).toEqual([
      { name: "LEFT CTRL", state: "DOWN" },
      { name: "LEFT CTRL", state: "DOWN" },
    ]);
  });
});
