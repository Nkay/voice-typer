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
    }

    entry.append(title, summary, table);
    container.appendChild(entry);
  }
}

window.historyAPI.onChanged(render);
window.historyAPI.get().then(render);
document.getElementById("clear").addEventListener("click", () => window.historyAPI.clear());
