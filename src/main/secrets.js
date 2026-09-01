const nodeFs = require("fs");

function createSecrets({ safeStorage, filePath, googleFilePath, fs = nodeFs }) {
  function _has(p) {
    return !!(p && fs.existsSync(p));
  }
  function _get(p) {
    if (!_has(p)) return null;
    const buf = fs.readFileSync(p);
    return safeStorage.decryptString(buf);
  }
  function _set(p, key) {
    if (!p) return;
    if (!key) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Encryption is not available on this system");
    }
    fs.writeFileSync(p, safeStorage.encryptString(key));
  }

  return {
    hasKey() { return _has(filePath); },
    getKey() { return _get(filePath); },
    setKey(key) { _set(filePath, key); },
    hasGoogleKey() { return _has(googleFilePath); },
    getGoogleKey() { return _get(googleFilePath); },
    setGoogleKey(key) { _set(googleFilePath, key); },
  };
}

module.exports = { createSecrets };
