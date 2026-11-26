import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, electron, frontend as root } from "./testing/dependencies.ts";
import { until } from "./testing/port.ts";

declare global {
  interface Window {
    recordingChecks: { notices: string[]; submissions: number };
  }
}

test("composer recording action never submits an unsent draft by mouse or keyboard", {
  timeout: 45000,
}, async () => {
  const job = await mkdtemp(path.join(tmpdir(), "apparent-dev-hermes-button-"));
  const main = path.join(job, "main.cjs");
  const renderer = path.join(job, "renderer.js");
  const html = path.join(job, "composer.html");
  const sdk = path.resolve(root, "../../../../hermes/desktop/testing/sdk.ts");
  const plugin = path.resolve(root, "../../../../hermes/desktop/plugin.ts");
  await build({
    stdin: {
      contents: `import { app, BrowserWindow } from 'electron';
    app.setPath('appData', process.env.HOME!); app.setPath('userData', process.env.HOME!);
    app.whenReady().then(() => { const view = new BrowserWindow({ show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      void view.loadFile(process.argv[2]); });`,
      loader: "ts",
      resolveDir: root,
    },
    outfile: main,
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
  });
  await build({
    stdin: {
      contents: `import React from 'react';
    import { createRoot } from 'react-dom/client';
    import plugin from ${JSON.stringify(plugin)};
    window.recordingChecks = { submissions: 0, notices: [] };
    let control;
    plugin.register({ onDispose() {}, setInterval() { return () => {}; },
      storage: { get() { return null; }, async set() {} },
      register(item) { if (item.id === 'record') control = item.render; } });
    createRoot(document.getElementById('root')).render(React.createElement('form', {
      onSubmit(event) { event.preventDefault(); window.recordingChecks.submissions++;
        document.querySelector('textarea').value = ''; }
    }, React.createElement('textarea', { 'aria-label': 'Draft' }),
      React.createElement(control), React.createElement('button', { type: 'submit' }, 'Send')));`,
      loader: "tsx",
      resolveDir: root,
    },
    outfile: renderer,
    bundle: true,
    platform: "browser",
    format: "iife",
    nodePaths: [path.join(root, "node_modules")],
    plugins: [
      {
        name: "synthetic-composer-sdk",
        setup(builder) {
          builder.onResolve({ filter: /^@hermes\/plugin-sdk$/ }, () => ({
            path: "sdk",
            namespace: "composer-fixture",
          }));
          builder.onLoad(
            { filter: /.*/, namespace: "composer-fixture" },
            () => ({
              loader: "tsx",
              resolveDir: root,
              contents: `import React from 'react'; import { host as mockedHost } from ${JSON.stringify(sdk)};
          export * from ${JSON.stringify(sdk)};
          export const Button = ({ variant, size, ...props }) => React.createElement('button', props);
          export const host = { ...mockedHost, state: { ...mockedHost.state,
            focusedSessionOwner: { get() { return null; } } },
            notify(notice) { window.recordingChecks.notices.push(notice.message); } };`,
            }),
          );
        },
      },
    ],
  });
  await writeFile(
    html,
    '<!doctype html><meta charset="UTF-8"><title>Synthetic Hermes composer</title><div id="root"></div><script src="renderer.js"></script>',
  );
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let passed = false;
  try {
    application = await electron.launch({
      args: [main, html],
      env: {
        ...process.env,
        HOME: job,
        XDG_CONFIG_HOME: path.join(job, "config"),
      },
    });
    const page = await application.firstWindow();
    for (const activation of ["mouse", "Enter", "Space"]) {
      await page.reload();
      await page
        .getByRole("textbox", { name: "Draft" })
        .fill("This draft must stay unsent.");
      const button = page.getByRole("button", { name: "Record with Apparent" });
      if (activation === "mouse") await button.click();
      else {
        await button.focus();
        await button.press(activation);
      }
      await until(() =>
        page.evaluate(() => window.recordingChecks.notices.length === 1),
      );
      assert.equal(
        await page.getByRole("textbox", { name: "Draft" }).inputValue(),
        "This draft must stay unsent.",
        activation,
      );
      assert.equal(
        await page.evaluate(() => window.recordingChecks.submissions),
        0,
        activation,
      );
      await page.getByRole("button", { name: "Send", exact: true }).click();
      assert.equal(
        await page.evaluate(() => window.recordingChecks.submissions),
        1,
      );
    }
    passed = true;
  } finally {
    await application?.close().catch(() => {});
    if (passed) await rm(job, { recursive: true, force: true });
    else console.log(`Failed composer action evidence: ${job}`);
  }
});
