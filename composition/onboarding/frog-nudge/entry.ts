import { app, BrowserWindow, screen, session } from "electron";
import { join } from "node:path";

process.stdin.resume();
process.stdin.once("end", () => app.quit());
app.on("window-all-closed", () => app.quit());

void app
  .whenReady()
  .then(async () => {
    if (process.platform === "darwin") app.setActivationPolicy("accessory");
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _kind, reply) => reply(false),
    );
    const { workArea } = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    );
    const width = Math.min(240, workArea.width);
    const height = Math.min(220, workArea.height);
    const window = new BrowserWindow({
      x:
        workArea.x +
        workArea.width -
        width -
        Math.min(32, workArea.width - width),
      y: workArea.y,
      width,
      height,
      frame: false,
      transparent: true,
      focusable: false,
      alwaysOnTop: true,
      hasShadow: false,
      skipTaskbar: true,
      resizable: false,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.setIgnoreMouseEvents(true);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("render-process-gone", () => app.exit(1));
    window.once("ready-to-show", () => window.showInactive());
    setTimeout(() => app.quit(), 11_000).unref();
    await window.loadFile(join(__dirname, "index.html"));
  })
  .catch(() => app.exit(1));
