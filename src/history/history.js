function cell(className, text) {
  const td = document.createElement("td");
  td.className = className;
  td.textContent = text;
  return td;
}

// `list` holds one view per dictation, made by describeTiming in the main process.
function render(list) {
  const container = document.getElementById("list");
  container.replaceChildren();
  document.getElementById("empty").hidden = list.length > 0;

  for (const view of list) {
    const entry = document.createElement("div");
    entry.className = "entry";

    const title = document.createElement("h2");
    title.textContent = new Date(view.at).toLocaleString();
    const summary = document.createElement("div");
    summary.className = "summary";
    summary.textContent = view.summary;

    const table = document.createElement("table");
    for (const row of view.rows) {
      const tr = document.createElement("tr");
      if (row.slowest) tr.className = "slowest";
      tr.append(cell("label", row.label), cell("value", row.value), cell("note", row.note));
      table.appendChild(tr);
      if (row.text) {
        const textRow = document.createElement("tr");
        const text = cell("text", row.text);
        text.colSpan = 3;
        textRow.appendChild(text);
        table.appendChild(textRow);
      }
    }

    entry.append(title, summary);
    if (view.recording) {
      const play = document.createElement("button");
      play.textContent = "Play recording";
      play.addEventListener("click", () => playRecording(view.recording));
      entry.appendChild(play);
    }
    entry.appendChild(table);
    container.appendChild(entry);
  }
}

// One player for all entries, outside the list: a new dictation renders the
// list again and must not stop the playback.
async function playRecording(name) {
  const bytes = await window.historyAPI.audio(name);
  const player = document.getElementById("player");
  if (!bytes) {
    player.hidden = true;
    alert("The recording is no longer there.");
    return;
  }
  if (player.src) URL.revokeObjectURL(player.src);
  player.src = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  player.hidden = false;
  player.play();
}

window.historyAPI.onChanged(render);
document.getElementById("folder").addEventListener("click", () => window.historyAPI.openFolder());
window.historyAPI.get().then(render);
document.getElementById("clear").addEventListener("click", () => window.historyAPI.clear());
