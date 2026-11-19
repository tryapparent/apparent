import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const frontend = fileURLToPath(
  new URL("../../../capture/desktop/ui/frontend/", import.meta.url),
);
const load = createRequire(join(frontend, "package.json"));
const { _electron: electron, expect } = load("@playwright/test");

test("installed General renders Connect facts with keyboard recovery and redacted receipts", {
  timeout: 60_000,
}, async (t) => {
  const home = await mkdtemp(join(tmpdir(), "cs-"));
  const directory = join(home, ".config/apparent/agent-control");
  const address = join(directory, "capture.sock");
  const clients = new Set<net.Socket>();
  const commands: unknown[] = [];
  const canary = "synthetic-private-canary";
  const base = {
    activity: "Idle",
    connected: true,
    uploadsEnabled: false,
    reauthorizationRequired: false,
    renewalDue: false,
    reusableUploadGrant: false,
    localReady: true,
    closed: false,
    encryption: true,
    retryDisable: null,
    server: "https://api.example.com",
    accountInitial: "S",
    userCode: null,
    verificationUri: null,
    sharedLinksUrl: null,
    localError: null,
    outcome: null,
    accessToken: canary,
    rawProviderError: canary,
  };
  let facts: Record<string, unknown> = {
    ...base,
    connected: false,
    accountInitial: null,
  };
  const server = net.createServer((socket) => {
    clients.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => clients.delete(socket));
    let pending = "";
    socket.on("data", (chunk) => {
      pending += chunk.toString();
      let boundary: number;
      while ((boundary = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, boundary);
        pending = pending.slice(boundary + 1);
        if (line === "state") {
          socket.end('{"state":{"phase":"idle"}}\n');
          return;
        }
        const request = JSON.parse(line);
        if (request.microphone === "read") {
          socket.end('{"microphone":{"enabled":false}}\n');
          return;
        }
        if (request.errorReporting === "read") {
          socket.end('{"errorReporting":{"enabled":false}}\n');
          return;
        }
        if (!request.connect) {
          socket.end('{"error":"feature_disabled"}\n');
          return;
        }
        if (request.command) commands.push(request.command);
        socket.write(`${JSON.stringify({ accountFacts: facts })}\n`);
      }
    });
  });
  let app: Awaited<ReturnType<typeof electron.launch>>;
  t.after(async () => {
    try {
      await app?.close();
    } finally {
      for (const socket of clients) socket.destroy();
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(home, { recursive: true, force: true });
    }
  });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(address, resolve);
  });
  await chmod(address, 0o600);
  const stage = process.env.APPARENT_CONNECT_STAGE;
  const runtime = stage
    ? join(
        stage,
        process.platform === "darwin"
          ? "runtime/Electron.app/Contents/MacOS/Electron"
          : "runtime/electron",
      )
    : load("electron");
  app = await electron.launch({
    executablePath: runtime,
    args: [
      stage ? join(stage, "app") : frontend,
      "--settings-storage",
      "--settings-general",
    ],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
  });
  const page = await app.firstWindow();
  await page.emulateMedia({ colorScheme: null });
  const card = page.getByRole("region", { name: "Apparent Connect" });
  await expect(
    card.getByRole("button", { name: "Connect with Google" }),
  ).toBeEnabled();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send(
      "apparent:general-state",
      {
        type: "general-state",
        platform: process.platform === "darwin" ? "macos" : "linux",
        login: { on: false, available: true, needsApproval: false },
        shortcuts: [],
        errorReporting: false,
      },
    );
  });
  await expect(
    page.getByRole("switch", { name: "Launch at login" }),
  ).toBeVisible();
  const evidence = process.env.CONNECT_EVIDENCE;
  if (evidence) await mkdir(evidence, { recursive: true });
  for (const theme of ["light", "dark"]) {
    for (const width of [720, 640]) {
      await app.evaluate(
        ({ nativeTheme, BrowserWindow }, { theme, width }) => {
          nativeTheme.themeSource = theme;
          BrowserWindow.getAllWindows()[0].setSize(width, 530);
        },
        { theme, width },
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => matchMedia("(prefers-color-scheme: dark)").matches,
          ),
        )
        .toBe(theme === "dark");
      for (const [outcome, headline, action] of [
        [null, "Connection needs a refresh.", "Check connection"],
        ["Offline", "Connect is offline.", "Check connection"],
        ["Rejected", "Sign-in wasn’t approved.", "Try again"],
        ["Cancelled", "Connection cancelled.", "Connect with Google"],
        ["Unavailable", "Connect is unavailable.", "Check connection"],
      ] as const) {
        facts = {
          ...base,
          outcome,
          connected: outcome !== "Rejected" && outcome !== "Cancelled",
          renewalDue: outcome === null,
        };
        await expect(
          card.getByRole("heading", { name: headline }),
        ).toBeVisible();
        const recovery = card.getByRole("button", {
          name: action,
          exact: true,
        });
        await expect(recovery).toBeEnabled();
        await recovery.focus();
        await expect(card.locator("button:focus")).toHaveText(action);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const received = await page.evaluate(() =>
          window.apparent.readConnectSettings(),
        );
        assert.equal(JSON.stringify(received).includes(canary), false);
        if (stage && outcome === null) {
          const native = spawnSync(
            runtime,
            [join(stage, "app/connect-client/dist/account/cli.js")],
            {
              cwd: home,
              env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
              input: JSON.stringify(facts),
              encoding: "utf8",
              timeout: 3000,
            },
          );
          assert.equal(native.status, 0);
          assert.deepEqual(JSON.parse(native.stdout), received.view);
        }
        if (evidence)
          await page.screenshot({
            path: join(evidence, `${outcome ?? "renew"}-${theme}-${width}.png`),
          });
      }
    }
  }
  await card
    .getByRole("button", { name: "Check connection", exact: true })
    .press("Enter");
  await expect.poll(() => commands).toEqual(["check"]);
  assert.equal(await page.getByText(canary).count(), 0);
});
