// The single source of truth for every key VoiceTyper can bind. Consumed by the
// poller (VK codes), config validation (name whitelist) and the Settings window
// (labels), so the three never drift apart.
const MODIFIER_KEYS = [
  { name: "RIGHT ALT", vk: 0xa5, label: "Right Alt (AltGr)" },
  { name: "LEFT ALT", vk: 0xa4, label: "Left Alt" },
  { name: "RIGHT CTRL", vk: 0xa3, label: "Right Ctrl" },
  { name: "LEFT CTRL", vk: 0xa2, label: "Left Ctrl" },
  { name: "RIGHT SHIFT", vk: 0xa1, label: "Right Shift" },
  { name: "LEFT SHIFT", vk: 0xa0, label: "Left Shift" },
];

// VK_F1 (0x70) through VK_F24 (0x87) are contiguous.
const FUNCTION_KEYS = Array.from({ length: 24 }, (_, i) => ({
  name: `F${i + 1}`,
  vk: 0x70 + i,
  label: `F${i + 1}`,
}));

// SPACE is not swallowed by the poller, so holding it also types spaces into the
// focused field. Offered anyway; the README documents the caveat.
const OTHER_KEYS = [{ name: "SPACE", vk: 0x20, label: "Space" }];

const KEYS = [...MODIFIER_KEYS, ...FUNCTION_KEYS, ...OTHER_KEYS];
const KEY_NAMES = KEYS.map((k) => k.name);
const VK_BY_NAME = new Map(KEYS.map((k) => [k.name, k.vk]));

function vkFor(name) {
  if (typeof name !== "string") return undefined;
  return VK_BY_NAME.get(name.toUpperCase());
}

module.exports = { KEYS, KEY_NAMES, vkFor };
