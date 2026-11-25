const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { createRequire } = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const frontend = path.resolve(
  __dirname,
  "../../../capture/desktop/ui/frontend",
);
const requireFrontend = createRequire(path.join(frontend, "package.json"));
const { _electron: electron, expect } = requireFrontend("@playwright/test");

test("the early pill snapshot can render before the document acknowledgement", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pill-bootstrap-"));
  let application;
  t.after(async () => {
    await application?.close().catch(() => {});
    await fs.rm(directory, { recursive: true, force: true });
  });
  const host = path.join(directory, "host.cjs");
  const main = path.join(frontend, "electron/pill/main.cjs");
  await fs.writeFile(
    host,
    `const { app, ipcMain } = require("electron");
const { PassThrough } = require("node:stream");
const parent = new PassThrough();
Object.defineProperty(process, "stdin", { value: parent });
globalThis.bootstrap = { snapshots: [], layouts: [] };
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => handle(channel, (event, ...args) => {
  if (channel === "pill:layout") globalThis.bootstrap.layouts.push(args[0]);
  return handler(event, ...args);
});
app.on("web-contents-created", (_event, contents) => {
  const send = contents.send.bind(contents);
  contents.send = (channel, update) => {
    if (channel === "pill:update" && update.documentReady !== undefined) {
      globalThis.bootstrap.snapshots.push(update.documentReady);
      if (update.documentReady) {
        globalThis.acknowledgeDocument = () => send(channel, update);
        return;
      }
    }
    send(channel, update);
  };
});
require(${JSON.stringify(main)});
parent.write(JSON.stringify({type:"state",view:{revision:1,phase:"recording",
  clock:"00:12",label:"Recording",warning:null,reducedMotion:false,draggable:false,
  actions:[{id:"finish",label:"Finish",enabled:true,selected:false,primary:true}]}})+"\\n");
`,
  );
  application = await electron.launch({
    args: [host, "--no-sandbox"],
    env: {
      ...process.env,
      HOME: directory,
      XDG_CONFIG_HOME: path.join(directory, "config"),
    },
  });
  const page = await application.firstWindow();
  await expect(
    page.getByRole("button", { name: "Finish", exact: true }),
  ).toHaveCount(1);
  await expect
    .poll(() => application.evaluate(() => !!globalThis.acknowledgeDocument))
    .toBe(true);
  assert.deepEqual(await application.evaluate(() => globalThis.bootstrap), {
    snapshots: [false, true],
    layouts: [],
  });
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    false,
  );
  await application.evaluate(() => globalThis.acknowledgeDocument());
  await expect
    .poll(() => application.evaluate(() => globalThis.bootstrap.layouts[0]))
    .toBe(1);
});
