const nodeFs = require("fs");

function createSecrets({ safeStorage, filePath, fs = nodeFs }) {
  return {
    hasKey() {
      return fs.existsSync(filePath);
    },
    getKey() {
      if (!fs.existsSync(filePath)) return null;
      const buf = fs.readFileSync(filePath);
      return safeStorage.decryptString(buf);
    },
    setKey(key) {
      if (!key) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return;
      }
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Encryption is not available on this system");
      }
      const enc = safeStorage.encryptString(key);
      fs.writeFileSync(filePath, enc);
    },
  };
}

module.exports = { createSecrets };
