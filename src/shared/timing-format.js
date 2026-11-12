const seconds = (ms, digits = 2) => `${(ms / 1000).toFixed(digits)} s`;

function modelRow(model) {
  const row = { label: model.label, value: model.ms == null ? "–" : seconds(model.ms), note: "", ms: model.ms };
  switch (model.status) {
    case "ok":
      row.note = model.typed ? "typed" : "answered later";
      break;
    case "empty":
      row.note = "heard nothing";
      break;
    case "failed":
      row.note = `failed (${model.error || "ERROR"})`;
      break;
    case "pending":
      row.value = "…";
      row.note = "no answer yet";
      break;
    default:
      row.note = "no answer";
  }
  if (model.primary) row.note = `primary, ${row.note}`;
  return row;
}

// Turns one entry of the timing history into the lines of the history window:
// one row for each step, in the order the steps happen.
function describeTiming(entry) {
  const typed = entry.typingMs != null;
  const models = entry.models.map(modelRow);
  const rows = [
    { label: "audio ready", value: seconds(entry.audioMs), note: "", ms: entry.audioMs },
    { label: "queue wait", value: seconds(entry.queueMs), note: "", ms: entry.queueMs },
    ...models,
  ];
  if (entry.primaryWaitMs != null) {
    rows.push({ label: "wait for primary", value: seconds(entry.primaryWaitMs), note: "", ms: entry.primaryWaitMs });
  }
  if (entry.summaryMs != null) {
    rows.push({
      label: "summary",
      value: seconds(entry.summaryMs),
      note: entry.summaryFailed ? "failed" : "",
      ms: entry.summaryMs,
    });
  }
  if (typed) {
    // Live text is typed during the hold, so only the end of it is measured.
    rows.push(
      entry.live
        ? {
            label: "typing after the last answer",
            value: seconds(entry.typingMs),
            note: `${entry.chars} characters in total, typed live`,
            ms: entry.typingMs,
          }
        : { label: "typing", value: seconds(entry.typingMs), note: `${entry.chars} characters`, ms: entry.typingMs }
    );
  }

  // The text waits only for the model that was typed. When no model gave a
  // text, the dictation waited for all of them.
  const anyTyped = entry.models.some((m) => m.typed);
  const onPath = rows.filter((row) => {
    const i = models.indexOf(row);
    return row.ms != null && (i === -1 || !anyTyped || entry.models[i].typed);
  });
  const slowest = onPath.reduce((max, row) => (max === null || row.ms > max.ms ? row : max), null);

  return {
    at: entry.at,
    summary:
      `recorded ${seconds(entry.recordMs, 1)} · ` +
      (typed ? `typing finished ${seconds(entry.totalMs, 1)} after release` : `nothing typed, ended ${seconds(entry.totalMs, 1)} after release`),
    rows: rows.map((row) => ({
      label: row.label,
      value: row.value,
      note: row.note,
      slowest: row === slowest && row.ms > 0,
    })),
  };
}

module.exports = { describeTiming };
