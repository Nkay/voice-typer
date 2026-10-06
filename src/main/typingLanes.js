// Serialises live typing across overlapping dictations. Each dictation opens a
// lane when its key goes down; lanes are typed strictly in the order they were
// opened, so text from the next dictation never lands in the middle of a slower
// earlier one (for example while the earlier one is still waiting for its
// summary).
//
// If typing stops because a modifier key stayed down (TyperError MODIFIER_HELD),
// the lane is diverted: the untyped text and everything pushed to the lane
// afterwards is collected and handed to onDiverted when the lane closes, rather
// than resuming in the middle of the text.
function createTypingLanes({ type, onDiverted = () => {}, onError = () => {} }) {
  const lanes = [];
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (lanes.length > 0) {
        const lane = lanes[0];
        if (lane.texts.length > 0) {
          const text = lane.texts.shift();
          if (lane.diverted !== null) {
            lane.diverted += text;
            continue;
          }
          try {
            await type(text);
          } catch (err) {
            if (err && err.code === "MODIFIER_HELD") lane.diverted = err.remaining || "";
            else onError(err);
          }
          continue;
        }
        if (!lane.closed) break;
        lanes.shift();
        if (lane.diverted) onDiverted(lane.diverted);
        lane.resolveDone();
      }
    } finally {
      running = false;
    }
  }

  function open() {
    const lane = { texts: [], closed: false, diverted: null, resolveDone: null };
    const done = new Promise((resolve) => (lane.resolveDone = resolve));
    lanes.push(lane);
    return {
      push(text) {
        if (lane.closed || typeof text !== "string" || text.length === 0) return;
        lane.texts.push(text);
        drain();
      },
      // Resolves once every text pushed to this lane is typed (or diverted).
      close() {
        lane.closed = true;
        drain();
        return done;
      },
      // Drops whatever was not typed yet. Used for a hold too short to count.
      discard() {
        lane.texts.length = 0;
        lane.closed = true;
        drain();
        return done;
      },
    };
  }

  return { open };
}

module.exports = { createTypingLanes };
