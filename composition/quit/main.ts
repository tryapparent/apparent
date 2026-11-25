import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import path from "node:path";
import readline from "node:readline";

const state = JSON.parse(process.argv.at(-1) ?? "");
const startError = state.kind === "record-start-error";
if (
  startError &&
  (typeof state.title !== "string" ||
    state.title.length > 120 ||
    typeof state.description !== "string" ||
    state.description.length > 300)
)
  throw Error("Invalid recording start error");
app.setName("Apparent");
app.setPath(
  "userData",
  app.commandLine.getSwitchValue("user-data-dir") ||
    path.join(
      app.getPath("appData"),
      startError ? "apparent-record-start-error" : "apparent-quit",
    ),
);

void app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      width: 480,
      height: startError ? 320 : 300,
      useContentSize: true,
      minWidth: 320,
      minHeight: startError ? 320 : 280,
      show: false,
      alwaysOnTop: startError,
      resizable: !startError,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#020102" : "#f5f0e8",
      title: "Apparent",
      autoHideMenuBar: true,
      maximizable: false,
      minimizable: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, "preload.cjs"),
      },
    });
    const input = readline.createInterface({ input: process.stdin });
    let reply: ((saved: boolean) => void) | undefined;
    input.on("line", (line) => {
      reply?.(line === "saved");
      reply = undefined;
    });
    input.once("close", () => app.quit());
    window.on("close", (event) => {
      if (reply) event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    ipcMain.handle("quit-state", (event) =>
      event.sender === window.webContents ? state : undefined,
    );
    ipcMain.handle("quit-decide", (event, quit: unknown, checked: unknown) => {
      if (
        event.sender !== window.webContents ||
        startError ||
        reply ||
        typeof quit !== "boolean" ||
        (checked !== null && (!state.available || typeof checked !== "boolean"))
      )
        return false;
      return new Promise<boolean>((resolve) => {
        reply = resolve;
        process.stdout.write(JSON.stringify({ quit, checked }) + "\n");
      });
    });
    ipcMain.on("quit-close", (event) => {
      if (event.sender === window.webContents && !reply) app.quit();
    });
    window.once("ready-to-show", () => {
      window.show();
      process.stdout.write("ready\n");
    });
    await window.loadFile(path.join(__dirname, "index.html"));
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

app.on("window-all-closed", () => app.quit());
