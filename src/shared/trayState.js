const STATES = ["active", "recording", "processing", "paused", "error"];

const TOOLTIPS = {
  active: "VoiceTyper (active)",
  recording: "VoiceTyper (recording)",
  processing: "VoiceTyper (transcribing)",
  paused: "VoiceTyper (paused)",
  error: "VoiceTyper (error)",
};

function trayView(state) {
  const icon = STATES.includes(state) ? state : "active";
  return { icon, tooltip: TOOLTIPS[icon] };
}

module.exports = { STATES, trayView };
