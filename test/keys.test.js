import { describe, it, expect } from "vitest";
import { KEYS, KEY_NAMES, vkFor } from "../src/shared/keys.js";

describe("key catalog", () => {
  it("contains the six modifiers, F1-F24 and SPACE", () => {
    expect(KEYS.length).toBe(31);
    expect(KEY_NAMES).toContain("RIGHT ALT");
    expect(KEY_NAMES).toContain("LEFT SHIFT");
    expect(KEY_NAMES).toContain("F1");
    expect(KEY_NAMES).toContain("F24");
    expect(KEY_NAMES).toContain("SPACE");
  });

  it("maps the modifier virtual-key codes correctly", () => {
    expect(vkFor("LEFT SHIFT")).toBe(0xa0);
    expect(vkFor("RIGHT SHIFT")).toBe(0xa1);
    expect(vkFor("LEFT CTRL")).toBe(0xa2);
    expect(vkFor("RIGHT CTRL")).toBe(0xa3);
    expect(vkFor("LEFT ALT")).toBe(0xa4);
    expect(vkFor("RIGHT ALT")).toBe(0xa5);
    expect(vkFor("SPACE")).toBe(0x20);
  });

  it("maps F1-F24 to the contiguous range 0x70-0x87", () => {
    for (let i = 1; i <= 24; i++) {
      expect(vkFor(`F${i}`)).toBe(0x70 + i - 1);
    }
  });

  it("has unique names and unique virtual-key codes", () => {
    expect(new Set(KEY_NAMES).size).toBe(KEYS.length);
    expect(new Set(KEYS.map((k) => k.vk)).size).toBe(KEYS.length);
  });

  it("gives every key a non-empty label", () => {
    for (const key of KEYS) {
      expect(typeof key.label).toBe("string");
      expect(key.label.length).toBeGreaterThan(0);
    }
  });

  it("looks names up case-insensitively and returns undefined for unknown keys", () => {
    expect(vkFor("right alt")).toBe(0xa5);
    expect(vkFor("f7")).toBe(0x76);
    expect(vkFor("ESCAPE")).toBeUndefined();
    expect(vkFor(undefined)).toBeUndefined();
  });
});
