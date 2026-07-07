import { describe, it, expect } from "vitest";
import { trayView, STATES } from "../src/shared/trayState.js";

describe("trayView", () => {
  it("maps each known state to its icon name", () => {
    for (const s of STATES) {
      expect(trayView(s).icon).toBe(s);
      expect(typeof trayView(s).tooltip).toBe("string");
    }
  });

  it("falls back to active for an unknown state", () => {
    expect(trayView("bogus").icon).toBe("active");
  });
});
