import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  session,
  type IpcMainInvokeEvent,
} from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import readline from "node:readline";
import type {
  Operation,
  Paper,
} from "../../../record/pill/whiteboard/renderer";

type Initial = { type: "initial"; practice: boolean; paper: Paper };
type Message =
  | Initial
  | { type: "paper"; sequence: number; paper: Paper }
  | { type: "focus" };

const operations = new Set<Operation>([
  "begin",
  "move",
  "end",
  "cancel",
  "undo",
  "clear",
  "close",
]);
const page = pathToFileURL(path.join(__dirname, "index.html")).href;
app.setName("Apparent Whiteboard");
app.setPath(
  "userData",
  app.commandLine.getSwitchValue("user-data-dir") ||
    path.join(
      app.getPath("appData"),
      process.env.APPARENT_PROFILE === "apparent-nightly"
        ? "apparent-nightly-whiteboard"
        : "apparent-whiteboard",
    ),
);

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});
let initial: Initial | undefined;
let window: BrowserWindow | undefined;
let sequence = 0;
let pending: { sequence: number; resolve: (paper: Paper) => void } | undefined;
let closing = false;

function send(message: object) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function close() {
  if (closing) return;
  closing = true;
  send({ type: "edit", sequence: ++sequence, operation: "close" });
}

function valid(event: IpcMainInvokeEvent) {
  return (
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url === page
  );
}

async function show() {
  await app.whenReady();
  app.dock?.hide();
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, reply) => reply(false),
  );
  const { workArea } = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  );
  const width = Math.min(720, workArea.width);
  const height = Math.min(540, workArea.height);
  const board = new BrowserWindow({
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
    minWidth: 320,
    minHeight: 280,
    frame: false,
    show: false,
    title: "Apparent Whiteboard",
    backgroundColor: "#f5f0e8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window = board;
  board.removeMenu();
  board.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  board.webContents.on("will-navigate", (event) => event.preventDefault());
  board.webContents.on("will-frame-navigate", (event) =>
    event.preventDefault(),
  );
  board.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  board.webContents.once("render-process-gone", () => app.exit(1));
  board.on("page-title-updated", (event) => event.preventDefault());
  board.on("show", () => {
    const { x, y, width, height } = board.getBounds();
    send({ type: "ready", frame: [x, y, width, height] });
  });
  board.on("close", (event) => {
    event.preventDefault();
    close();
  });

  ipcMain.handle("whiteboard:initial", (event) => {
    if (!valid(event)) throw Error("Invalid Whiteboard frame");
    return initial;
  });
  ipcMain.handle(
    "whiteboard:edit",
    (event, operation: Operation, point: unknown) => {
      if (!valid(event) || closing || !operations.has(operation))
        throw Error("Invalid Whiteboard edit");
      if (operation === "close") {
        close();
        return null;
      }
      if (pending) throw Error("Whiteboard edit pending");
      if (operation === "begin" || operation === "move") {
        if (
          !Array.isArray(point) ||
          point.length !== 2 ||
          !point.every(Number.isFinite) ||
          point[0] < 0 ||
          point[0] >= 1600 ||
          point[1] < 0 ||
          point[1] >= 1100
        )
          throw Error("Invalid Whiteboard point");
        send({ type: "edit", sequence: ++sequence, operation, point });
        return null;
      }
      if (point !== undefined) throw Error("Unexpected Whiteboard point");
      return new Promise<Paper>((resolve) => {
        pending = { sequence: ++sequence, resolve };
        send({ type: "edit", sequence, operation });
      });
    },
  );
  ipcMain.on("whiteboard:ready", (event) => {
    if (valid(event)) board.show();
  });
  await board.loadURL(page);
}

process.stdout.on("error", () => app.exit(1));
process.stdin.on("error", () => app.exit(1));
input.on("close", () => app.exit(0));
input.on("line", (line) => {
  try {
    const message = JSON.parse(line) as Message;
    switch (message.type) {
      case "initial":
        if (initial) throw Error("Duplicate Whiteboard initialization");
        initial = message;
        void show().catch(() => app.exit(1));
        break;
      case "paper":
        if (!pending || pending.sequence !== message.sequence)
          throw Error("Unexpected Whiteboard reply");
        pending.resolve(message.paper);
        pending = undefined;
        break;
      case "focus":
        window?.focus();
        break;
    }
  } catch {
    app.exit(1);
  }
});
