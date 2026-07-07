import { describe, it, expect } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import { createSecrets } from "../src/main/secrets.js";

// Fake safeStorage: reversible base64 "encryption".
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s, "utf8").toString("base64"),
  decryptString: (buf) => Buffer.from(buf.toString(), "base64").toString("utf8"),
};

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vt-sec-")), "key.enc");
}

describe("secrets", () => {
  it("reports no key before one is set", () => {
    const s = createSecrets({ safeStorage: fakeSafeStorage, filePath: tmpFile(), fs });
    expect(s.hasKey()).toBe(false);
    expect(s.getKey()).toBe(null);
  });

  it("round-trips a key through set/get", () => {
    const s = createSecrets({ safeStorage: fakeSafeStorage, filePath: tmpFile(), fs });
    s.setKey("secret-123");
    expect(s.hasKey()).toBe(true);
    expect(s.getKey()).toBe("secret-123");
  });

  it("clears the key when set to empty", () => {
    const p = tmpFile();
    const s = createSecrets({ safeStorage: fakeSafeStorage, filePath: p, fs });
    s.setKey("x");
    s.setKey("");
    expect(s.hasKey()).toBe(false);
  });

  it("refuses to store a key when encryption is unavailable, writing nothing", () => {
    const p = tmpFile();
    const noEncryption = { ...fakeSafeStorage, isEncryptionAvailable: () => false };
    const s = createSecrets({ safeStorage: noEncryption, filePath: p, fs });
    expect(() => s.setKey("secret-123")).toThrow(/not available/i);
    expect(fs.existsSync(p)).toBe(false);
    expect(s.hasKey()).toBe(false);
  });
});
