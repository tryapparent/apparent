import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { PracticeHost } from "@apparent/onboarding/practice-host";
import { parseAction } from "@apparent/onboarding/actions";
import {
  project,
  record,
  type Projection,
} from "@apparent/onboarding/projection";
import { completedSelection } from "@apparent/onboarding/selection";
import {
  WisprOnboarding,
  type WisprProvider,
} from "@apparent/onboarding/wispr";
import type {
  OnboardingConnectAction,
  Reply,
} from "@apparent/connect-native-adapter/onboarding";
import { parentChannel } from "./channel.ts";
import { Placement } from "./place.ts";
import frogPolicy from "@apparent/onboarding/desktop-frog";

type Capabilities = {
  assets: string;
  connect: {
    close(): void;
    request(action?: OnboardingConnectAction): Promise<Reply>;
  };
  wispr: WisprProvider;
  wisprEnabled(): Promise<boolean>;
};
export function start(capabilities: Capabilities) {
  const require = createRequire(path.join(capabilities.assets, "package.json"));
  const { transparentBackgroundColor } =
    require("@apparent/ui/window-theme") as {
      transparentBackgroundColor: string;
    };
  app.setName(
    process.env.APPARENT_TEST_INSTANCE === "1"
      ? "apparent onboarding preview"
      : "apparent onboarding",
  );
  app.setPath(
    "userData",
    process.env.APPARENT_UI_PROFILE ||
      path.join(
        app.getPath("appData"),
        `${process.env.APPARENT_PROFILE === "apparent-nightly" ? "apparent-nightly" : "apparent"}-onboarding`,
      ),
  );
  let window: BrowserWindow,
    placement: Placement,
    state: Projection | null = null,
    page = "",
    closing = false,
    buffer = "";
  const practiceHost = new PracticeHost();
  let practiceEnabled = false;
  const connect = capabilities.connect;
  const wispr = new WisprOnboarding(
    () => state,
    capabilities.wisprEnabled,
    capabilities.wispr,
  );
  const channel = parentChannel(process.stdout, (error) => {
    const expected = [
      "EPIPE",
      "ECONNRESET",
      "ERR_STREAM_DESTROYED",
      "ERR_STREAM_WRITE_AFTER_END",
    ].includes((error as NodeJS.ErrnoException).code ?? "");
    if (!expected) console.error("Onboarding parent channel failed:", error);
    shutdown(expected ? 0 : 1);
  });
  function shutdown(code = 0) {
    if (closing) return;
    closing = true;
    channel.close();
    connect.close();
    wispr.close();
    if (code) app.exit(code);
    else app.quit();
  }
  function present(activate = false) {
    if (!closing && state) placement.present(state, activate);
  }
  app.whenReady().then(() => {
    app.dock?.hide();
    session.defaultSession.setPermissionRequestHandler((_w, _p, cb) =>
      cb(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    window = new BrowserWindow({
      width: 760,
      height: 720,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      backgroundColor: transparentBackgroundColor,
      webPreferences: {
        preload: path.join(
          capabilities.assets,
          "electron/onboarding-preload.cjs",
        ),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    placement = new Placement(window);
    window.setTitle(`Apparent onboarding ${process.pid}`);
    window.on("page-title-updated", (event) => event.preventDefault());
    window.removeMenu();
    const native = process.argv.includes("--native-onboarding");
    page =
      pathToFileURL(
        path.join(
          capabilities.assets,
          native ? "dist/index.html" : "dist/onboarding.html",
        ),
      ).href + (native ? "?nativeOnboarding" : "");
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (e) => e.preventDefault());
    window.webContents.on("will-attach-webview", (e) => e.preventDefault());
    const valid = (e: IpcMainInvokeEvent) =>
      !window.isDestroyed() &&
      e.sender === window.webContents &&
      e.senderFrame === window.webContents.mainFrame &&
      e.senderFrame.url === page;
    ipcMain.handle("onboarding:wispr", (e, ...args: unknown[]) => {
      if (!valid(e) || args.length !== 1)
        throw Error("Forbidden Wispr request");
      return wispr.request(args[0]);
    });
    let pendingConnect = false;
    const connectActions = new Set([
      "connect",
      "allow",
      "cancel",
      "disable",
      "open-browser",
      "check",
      "resume",
    ]);
    ipcMain.handle("onboarding:connect", async (e, ...args: unknown[]) => {
      const action = args[0];
      if (
        !valid(e) ||
        state?.step !== "welcome" ||
        state.penPicker ||
        args.length !== 1 ||
        !(
          action === null ||
          (typeof action === "string" && connectActions.has(action))
        )
      )
        throw Error("Forbidden Connect request");
      if (pendingConnect) return { status: "error" };
      pendingConnect = true;
      try {
        const result = await connect.request(
          action === null ? undefined : (action as OnboardingConnectAction),
        );
        if (
          closing ||
          window.isDestroyed() ||
          state?.step !== "welcome" ||
          state.penPicker
        ) {
          connect.close();
          return { status: "cancelled" };
        }
        if (result.openUri !== undefined)
          await shell.openExternal(result.openUri);
        const { openUri, ...safe } = result;
        return safe;
      } catch {
        return { status: "error" };
      } finally {
        pendingConnect = false;
      }
    });
    ipcMain.handle("onboarding:close-connect", (e, ...args: unknown[]) => {
      if (!valid(e) || args.length) throw Error("Forbidden Connect close");
      connect.close();
    });
    window.webContents.on("did-start-navigation", () => connect.close());
    window.webContents.on("render-process-gone", () => connect.close());
    ipcMain.handle("onboarding:state", (e, ...args: unknown[]) => {
      if (!valid(e) || args.length) throw Error("Forbidden state request");
      return state;
    });
    ipcMain.handle("onboarding:action", (e, ...args: unknown[]) => {
      if (!valid(e) || args.length !== 1)
        throw Error("Forbidden onboarding action");
      const request = args[0];
      if (
        record(request) &&
        request.action === "frog-name" &&
        state?.frogNaming &&
        typeof request.name === "string"
      ) {
        const name = request.name.trim();
        return (
          frogPolicy.accept_name(/\p{Cc}/u.test(name), name.length) &&
          channel.send({ type: "frog-name", name })
        );
      }
      if (
        record(request) &&
        request.action === "frog-finish" &&
        state?.frogName &&
        state.practice === "complete"
      ) {
        const bounds = window.getContentBounds();
        const point = request.takeoff;
        if (
          !Array.isArray(point) ||
          point.length !== 3 ||
          !point.every(Number.isFinite)
        )
          return false;
        const [x, y, width] = point;
        if (
          x < 0 ||
          x > bounds.width ||
          y < 0 ||
          y > bounds.height ||
          width < 20 ||
          width > 180
        )
          return false;
        return channel.send({
          type: "frog-finish",
          takeoff: [bounds.x + x, bounds.y + y, width],
        });
      }
      const action = parseAction(args[0]);
      if (action.action === "board")
        throw Error("Forbidden onboarding command");
      return channel.send(action);
    });
    window.webContents.on("render-process-gone", () => shutdown(1));
    window.webContents.on("did-finish-load", () => present());
    window.on("close", (event) => {
      if (closing) return;
      event.preventDefault();
      channel.send("close");
    });
    window.on("closed", () => {
      shutdown();
    });
    void window.loadURL(page);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      if (closing) return;
      buffer += chunk;
      if (buffer.length > 16777216) {
        shutdown(1);
        return;
      }
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let v: unknown;
        try {
          v = JSON.parse(line);
        } catch {
          console.error("Invalid onboarding parent message");
          shutdown(1);
          return;
        }
        if (!record(v)) {
          shutdown(1);
          return;
        }
        if (v.type === "practice-batch") {
          try {
            const reply = practiceHost.accept(v);
            practiceEnabled = true;
            channel.send(reply);
            if (state) {
              state = {
                ...state,
                practice: reply.stage,
                practiceAttempt:
                  state.practice === reply.stage ? state.practiceAttempt : null,
              };
              present();
            }
          } catch {
            shutdown(1);
            return;
          }
          continue;
        }
        if (v.type === "close") {
          shutdown();
          return;
        }
        if (v.type === "hide") {
          if (state?.step !== "try-it") window.hide();
          continue;
        }
        if (v.type === "show") {
          present(true);
          continue;
        }
        if (v.type === "desktop-shortcut") {
          if (
            state?.platform === "linux" &&
            v.keyCode === 201 &&
            v.key === "Copilot" &&
            typeof v.modifiers === "number" &&
            Number.isInteger(v.modifiers) &&
            (v.modifiers & ~6912) === 0
          )
            window.webContents.send("onboarding:desktop-shortcut", {
              keyCode: 201,
              modifiers: v.modifiers,
              key: "Copilot",
            });
          continue;
        }
        const next = project(v);
        if (next) {
          if (practiceEnabled && next.practice !== practiceHost.state.stage) {
            next.practice = practiceHost.state.stage;
            next.practiceAttempt = null;
          }
          if (
            JSON.stringify([
              state?.step,
              state?.fix,
              state?.shortcutChosen,
              state?.wisprFlowEnabled,
            ]) !==
            JSON.stringify([
              next.step,
              next.fix,
              next.shortcutChosen,
              next.wisprFlowEnabled,
            ])
          )
            wispr.close();
          state = next;
          const accepted = completedSelection(next);
          if (accepted) channel.send(accepted);
          present();
        }
      }
    });
    process.stdin.on("end", () => shutdown());
    process.stdin.on("error", (error) => {
      console.error("Onboarding input failed:", error);
      shutdown(1);
    });
    process.stdin.resume();
  });
}
