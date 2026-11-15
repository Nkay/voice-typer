import { describe, it, expect } from "vitest";
import { MERGE_PROMPT, mergeInput } from "../src/shared/merger.js";

describe("mergeInput", () => {
  it("lists the dictionary and then each transcript with its model", () => {
    const input = mergeInput(
      [
        { label: "Mistral", text: "äh hallo welt" },
        { label: "Google", text: "Hallo Welt." },
      ],
      ["chax", "VoiceTyper"]
    );

    expect(input).toBe(
      "<dictionary>\nchax\nVoiceTyper\n</dictionary>\n\n" +
        '<transcript model="Mistral">\näh hallo welt\n</transcript>\n\n' +
        '<transcript model="Google">\nHallo Welt.\n</transcript>'
    );
  });

  it("leaves the dictionary out when it has no terms", () => {
    expect(mergeInput([{ label: "Mistral", text: "a" }], [])).toBe('<transcript model="Mistral">\na\n</transcript>');
  });

  it("asks to remove fillers and to keep everything else", () => {
    expect(MERGE_PROMPT).toMatch(/filler/);
    expect(MERGE_PROMPT).toMatch(/Do not rephrase/);
  });
});
