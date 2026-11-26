import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  connectToEndpoint,
  waitFor,
} from "../../../shared/enablement/performance/electron-observer.ts";

const frontend = fileURLToPath(
  new URL("../../../capture/desktop/ui/frontend/", import.meta.url),
);
const assets = process.env.APPARENT_FROG_TEST_ASSETS ?? frontend;
const require = createRequire(join(frontend, "package.json"));

test("desktop frog renders and sends a start only after hiding", {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), "desktop-frog-"));
  const args = [
    "--ozone-platform=x11",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    join(assets, "dist/composition/onboarding/entry.cjs"),
    "--assets-root",
    assets,
    "--desktop-frog",
  ];
  const runtime =
    process.env.APPARENT_FROG_TEST_ELECTRON ?? require("electron");
  const child = spawn(runtime, args, {
    env: { ...process.env, APPARENT_UI_PROFILE: profile },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let page: Awaited<ReturnType<typeof connectToEndpoint>> | undefined;
  t.after(async () => {
    child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 2500);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
      page?.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
  let log = "";
  let output = "";
  child.stderr.on("data", (bytes) => (log += bytes));
  child.stdout.on("data", (bytes) => (output += bytes));
  const send = (value: object) =>
    child.stdin.write(JSON.stringify(value) + "\n");
  const project = (
    visible: boolean,
    revision: number,
    shortcut = "Ctrl+R",
    equipped: string[] = [],
  ) => send({ visible, revision, shortcut, equipped });
  send({ name: "Pip" });
  project(true, 1);
  const endpoint = await waitFor(async () => {
    assert.equal(child.exitCode ?? child.signalCode, null, log);
    return log.match(
      /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/,
    )?.[1];
  }, "Electron debugger");
  const endpointUrl = new URL(endpoint);
  const target = await waitFor(async () => {
    const response = await fetch(`http://${endpointUrl.host}/json/list`);
    const pages = (await response.json()) as {
      url: string;
      webSocketDebuggerUrl: string;
    }[];
    return pages.find((entry) => entry.url.endsWith("/desktop.html"));
  }, "desktop frog page");
  page = await connectToEndpoint(target.webSocketDebuggerUrl, "desktop-frog");
  const frog = page;
  await waitFor(
    async () =>
      (await frog.evaluate<boolean>(
        `!!document.querySelector('[aria-label="Make Pip hop"]')`,
      ))
        ? true
        : undefined,
    "named frog",
  );
  const title = await frog.evaluate<string>("document.title");
  assert.ok(title);
  const viewable = () => {
    try {
      return /Map State: IsViewable/.test(
        execFileSync("xwininfo", ["-name", title], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }),
      );
    } catch {
      return false;
    }
  };
  const waitForMapped = (visible: boolean) =>
    waitFor(
      async () => (viewable() === visible ? true : undefined),
      visible ? "mapped frog" : "hidden frog",
    );
  await waitForMapped(true);
  project(false, 2);
  await waitForMapped(false);
  await frog.evaluate('document.querySelector(".desktop-frog-record").click()');
  project(true, 3, "Alt+R", ["sunglasses"]);
  await waitForMapped(true);
  await waitFor(
    async () =>
      (await frog.evaluate<string>(
        'document.querySelector(".desktop-frog-tip kbd")?.textContent',
      )) === "Alt+R"
        ? true
        : undefined,
    "updated shortcut",
  );
  await frog.evaluate('document.querySelector(".desktop-frog-record").focus()');
  const fits = await frog.evaluate<boolean>(`(() => {
    const { left, right } = document.querySelector(".desktop-frog-tip").getBoundingClientRect();
    return left >= 0 && right <= innerWidth;
  })()`);
  assert.equal(fits, true);
  assert.equal(
    await frog.evaluate<boolean>(
      'document.activeElement.matches(".desktop-frog-record")',
    ),
    true,
  );
  await frog.click(".desktop-frog-record");
  await waitFor(
    async () => (output.includes("record 3\n") ? true : undefined),
    "start intent",
  );
  assert.equal(viewable(), false);
  assert.equal(output, "record 3\n");
  project(false, 4);
  send({ type: "record-settled" });
  await waitForMapped(false);
  project(true, 5);
  await waitForMapped(true);
  if (process.env.APPARENT_FROG_EVIDENCE) {
    await frog.evaluate(
      'document.querySelector(".desktop-frog-record").focus()',
    );
    for (const theme of ["light", "dark"]) {
      await frog.send("Emulation.setEmulatedMedia", {
        features: [
          { name: "prefers-color-scheme", value: theme },
          { name: "prefers-reduced-motion", value: "reduce" },
        ],
      });
      await frog.painted();
      const { data } = await frog.send<{ data: string }>(
        "Page.captureScreenshot",
      );
      await writeFile(
        join(process.env.APPARENT_FROG_EVIDENCE, `frog-${theme}.png`),
        Buffer.from(data, "base64"),
      );
    }
  }
});
