import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  powerMonitor,
  screen,
  session,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Rectangle,
} from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import frogPolicy from "@apparent/onboarding/desktop-frog";
import { record } from "@apparent/onboarding/projection";

const width = 148;
const height = 94;

export function startDesktopFrog(assets: string) {
  app.setName("apparent desktop frog");
  app.setPath(
    "userData",
    process.env.APPARENT_UI_PROFILE ||
      join(
        app.getPath("appData"),
        process.env.APPARENT_PROFILE === "apparent-nightly"
          ? "apparent-nightly-desktop-frog"
          : "apparent-desktop-frog",
      ),
  );
  const profile = app.getPath("userData");
  const pauseFile = join(profile, "frog-paused-until");
  let pausedUntil = 0;
  try {
    const stored = Number(readFileSync(pauseFile, "utf8"));
    if (Number.isSafeInteger(stored)) pausedUntil = stored;
  } catch {}
  let wake: ReturnType<typeof setTimeout> | undefined;
  const directory = join(assets, "dist/composition/onboarding/desktop-frog");
  const page = pathToFileURL(join(directory, "desktop.html")).href;
  let name = "";
  let shortcut = "";
  let equipped: string[] = [];
  let takeoff: [number, number, number] | undefined;
  let visible = false;
  let displayId: number | undefined;
  let window: BrowserWindow | undefined;
  let flight: BrowserWindow | undefined;
  let desktopReady = false;
  let flightReady = false;
  let landing: ReturnType<typeof setTimeout> | undefined;
  let placed: Rectangle | undefined;
  let grip: { x: number; y: number } | undefined;
  let flightPath:
    | {
        fromX: number;
        fromY: number;
        fromWidth: number;
        toX: number;
        toY: number;
      }
    | undefined;

  const input = createInterface({ input: process.stdin });
  input.on("close", () => app.quit());
  process.stdout.on("error", () => app.quit());
  input.on("line", (line) => {
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch {
      app.quit();
      return;
    }
    if (!record(data)) return;
    if (
      !name &&
      typeof data.name === "string" &&
      frogPolicy.accept_name(/\p{Cc}/u.test(data.name), data.name.length)
    ) {
      name = data.name;
      const point = data.takeoff;
      if (
        Array.isArray(point) &&
        point.length === 3 &&
        point.every(Number.isFinite)
      )
        takeoff = [point[0], point[1], point[2]];
    }
    if (
      typeof data.visible === "boolean" &&
      typeof data.shortcut === "string"
    ) {
      visible = data.visible;
      if (shortcut !== data.shortcut) {
        shortcut = data.shortcut;
        window?.webContents.send("desktop-frog:shortcut", shortcut);
      }
    }
    if (Array.isArray(data.equipped)) {
      equipped = data.equipped.filter(
        (item) =>
          item === "sunglasses" ||
          item === "lily-pad" ||
          item === "unicorn-horn",
      );
      window?.webContents.send("desktop-frog:wardrobe", equipped);
    }
    if (app.isReady()) present();
  });

  function owns(
    event: IpcMainEvent | IpcMainInvokeEvent,
    target: BrowserWindow | undefined,
  ) {
    return (
      target &&
      event.sender === target.webContents &&
      event.senderFrame === target.webContents.mainFrame &&
      event.senderFrame.url === page
    );
  }
  ipcMain.handle("desktop-frog:read", (event) => {
    if (owns(event, flight)) return { name, shortcut, flight: flightPath };
    if (owns(event, window)) return { name, shortcut, equipped };
    throw Error("Forbidden desktop frog request");
  });
  ipcMain.on("desktop-frog:start", (event) => {
    if (available() && owns(event, window)) process.stdout.write("record\n");
  });
  ipcMain.on("desktop-frog:menu", (event) => {
    if (!window || !available() || !owns(event, window)) return;
    Menu.buildFromTemplate([
      {
        label: "Quit for 1 hour",
        click: () => {
          if (!available()) return;
          pausedUntil = Date.now() + frogPolicy.desktop_pause_ms();
          present();
          scheduleWake();
          try {
            mkdirSync(profile, { recursive: true });
            const pendingPause = `${pauseFile}.${process.pid}`;
            writeFileSync(pendingPause, String(pausedUntil), { mode: 0o600 });
            renameSync(pendingPause, pauseFile);
          } catch (error) {
            console.error("Could not save the desktop frog pause:", error);
          }
        },
      },
    ]).popup({ window });
  });
  ipcMain.on("desktop-frog:drag", (event, phase: unknown) => {
    if (!available() || !owns(event, window) || !window) return;
    const cursor = screen.getCursorScreenPoint();
    if (phase === "begin") {
      const bounds = window.getBounds();
      grip = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
      return;
    }
    if (phase === "cancel") {
      grip = undefined;
      return;
    }
    if (!grip || (phase !== "move" && phase !== "drop")) return;
    const target = screen.getDisplayNearestPoint(cursor);
    displayId = target.id;
    placed = placeInside(
      target.workArea,
      cursor.x - grip.x,
      cursor.y - grip.y + (phase === "drop" ? 6 : 0),
    );
    window.setBounds(placed);
    if (phase === "drop") grip = undefined;
  });
  ipcMain.on("desktop-frog:arrived", (event) => {
    if (owns(event, flight)) settle();
  });

  function placeInside(area: Rectangle, x: number, y: number): Rectangle {
    return {
      x: Math.round(
        Math.min(Math.max(x, area.x), area.x + Math.max(0, area.width - width)),
      ),
      y: Math.round(
        Math.min(
          Math.max(y, area.y),
          area.y + Math.max(0, area.height - height),
        ),
      ),
      width,
      height,
    };
  }

  function makeWindow(bounds: Rectangle, overlay: boolean) {
    const win = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: !overlay,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: join(directory, "preload.cjs"),
        sandbox: true,
        contextIsolation: true,
      },
    });
    win.setContentProtection(true);
    win.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true });
    win.setIgnoreMouseEvents(overlay);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("render-process-gone", () => app.quit());
    return win;
  }

  function settle() {
    clearTimeout(landing);
    flight?.destroy();
    flight = undefined;
    if (desktopReady && available()) window?.showInactive();
  }

  function available() {
    return frogPolicy.desktop_visible(visible, Date.now() < pausedUntil);
  }

  function scheduleWake() {
    clearTimeout(wake);
    const remaining = pausedUntil - Date.now();
    if (remaining > 0) {
      wake = setTimeout(
        () => {
          present();
          scheduleWake();
        },
        Math.min(remaining, frogPolicy.desktop_pause_ms()),
      );
    }
  }

  function present() {
    if (!available()) {
      grip = undefined;
      window?.hide();
      if (flight) settle();
      return;
    }
    if (!name) return;
    if (window) {
      if (desktopReady && !flight) window.showInactive();
      return;
    }
    const origin = takeoff;
    takeoff = undefined;
    const target = origin
      ? screen.getDisplayNearestPoint({
          x: Math.round(origin[0]),
          y: Math.round(origin[1]),
        })
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    displayId = target.id;
    const area = target.workArea;
    const point = (placed = placeInside(
      area,
      area.x + area.width - width - 12,
      area.y + area.height - height - 10,
    ));
    window = makeWindow(point, false);
    window.on("ready-to-show", () => {
      desktopReady = true;
      if (available() && !flight) window?.showInactive();
    });
    if (origin) {
      flightPath = {
        fromX: origin[0] - area.x,
        fromY: origin[1] - area.y,
        fromWidth: origin[2],
        toX: point.x - area.x + width / 2,
        toY: point.y - area.y + 50,
      };
      const overlay = (flight = makeWindow(area, true));
      overlay.once("ready-to-show", () => {
        flightReady = true;
        if (available()) overlay.showInactive();
      });
      landing = setTimeout(settle, 2200);
      void overlay.loadURL(page).catch(() => {
        if (!flightReady) settle();
      });
    }
    void window.loadURL(page).catch(() => app.quit());
  }

  void app.whenReady().then(() => {
    if (process.platform === "darwin") app.setActivationPolicy("accessory");
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _kind, reply) => reply(false),
    );
    const rehome = () => {
      if (!window || !placed) return;
      const area = (
        screen.getAllDisplays().find((display) => display.id === displayId) ??
        screen.getPrimaryDisplay()
      ).workArea;
      placed = placeInside(area, placed.x, placed.y);
      window.setBounds(placed);
      if (flight) settle();
    };
    screen.on("display-removed", rehome);
    screen.on("display-metrics-changed", rehome);
    powerMonitor.on("resume", () => {
      present();
      scheduleWake();
    });
    scheduleWake();
    present();
  });
}
