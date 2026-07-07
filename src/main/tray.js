const path = require("path");
const { trayView } = require("../shared/trayState.js");

function createTray({ Tray, Menu, nativeImage, iconDir, onTogglePause, onOpenSettings, onQuit, isPaused }) {
  const iconFor = (name) => nativeImage.createFromPath(path.join(iconDir, `${name}.png`));

  const tray = new Tray(iconFor("active"));

  const rebuildMenu = () => {
    const menu = Menu.buildFromTemplate([
      { label: "Paused", type: "checkbox", checked: isPaused(), click: onTogglePause },
      { type: "separator" },
      { label: "Settings…", click: onOpenSettings },
      { label: "Quit", click: onQuit },
    ]);
    tray.setContextMenu(menu);
  };

  // Toggling pause flows back through controller.setPaused -> setState -> rebuildMenu,
  // so the click handler calls the injected callback directly.
  rebuildMenu();

  return {
    setState(state) {
      const view = trayView(state);
      tray.setImage(iconFor(view.icon));
      tray.setToolTip(view.tooltip);
      rebuildMenu();
    },
    destroy() {
      tray.destroy();
    },
  };
}

module.exports = { createTray };
