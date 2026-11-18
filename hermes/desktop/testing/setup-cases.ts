import { test } from "node:test";
import assert from "node:assert/strict";
import { shared } from "./sdk.ts";
import { fixture, packet, reset, until } from "./fixture.ts";

test("fresh canonical chat gets setup instructions without creating a conversation or sending the draft", async () => {
  reset();
  shared.owner = { connectionId: "local-A", profile: "default" };
  shared.session = null;
  shared.storedSession = null;
  shared.setupStatus = { schema: 1, status: "setup_required" };
  const originalFetch = globalThis.fetch;
  const f = fixture();
  globalThis.fetch = async () => packet("recording");
  try {
    const draft = shared.newDraft;
    f.click();
    await until(() => shared.notices.length === 1);
    assert.deepEqual(
      shared.requests.map(({ route, method, params }) => [
        route,
        method,
        params,
      ]),
      [
        [shared.routes[1], "plugin.apparent.setup_status", {}],
        [shared.routes[1], "runtime.describe", {}],
      ],
    );
    assert.equal(shared.newDraft, draft);
    assert.equal(shared.opens.length, 0);
    assert.equal(f.writes(), 0);
    assert.equal(shared.submissions.length, 0);
    const notice = shared.notices[0];
    assert.equal(notice.kind, "info");
    assert.equal(notice.action, undefined);
    assert.match(notice.message, /app launcher/);
    assert.deepEqual(f.externalUrls, []);
    shared.setupStatus = { schema: 1, status: "ready" };
    f.click();
    await until(() =>
      shared.requests.some((item) =>
        item.params.command?.includes("hermes record"),
      ),
    );
    assert.equal(shared.opens.length, 1);
    assert.equal(shared.submissions.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    f.dispose();
  }
});

test("legacy shell checks the local recorder for an SSH chat without creating a helper", async () => {
  reset();
  shared.setupRpcError = { code: -32601 };
  shared.legacyRuntimeDescribe = true;
  shared.shellSetupResult = {
    code: 127,
    stdout: "",
    stderr: "apparent: not found",
  };
  const f = fixture();
  try {
    f.click();
    await until(() => shared.notices.length === 1);
    assert.deepEqual(
      shared.requests.map((item) => [
        item.route.mode,
        item.method,
        item.params,
      ]),
      [
        ["local", "plugin.apparent.setup_status", {}],
        ["local", "runtime.describe", {}],
        ["local", "shell.exec", { command: "apparent hermes status" }],
      ],
    );
    assert.equal(shared.notices[0].action?.label, "Install Apparent");
    shared.notices[0].action?.onClick();
    assert.deepEqual(f.externalUrls, ["https://app.tryapparent.com/"]);
    assert.equal(f.writes(), 0);
    shared.shellSetupResult = {
      code: 0,
      stdout: '{"schema":1,"status":"setup_required"}',
      stderr: "",
    };
    f.click();
    await until(() => shared.notices.length === 2);
    shared.notices[1].action?.onClick();
    await until(() =>
      shared.requests.some((item) =>
        item.params.command?.includes("apparent launch apparent://open"),
      ),
    );
    assert.equal(
      shared.requests.some((item) => item.method === "session.create"),
      false,
    );
  } finally {
    f.dispose();
  }
});

test("a connection switch during setup preflight prevents navigation and capture", async () => {
  reset();
  shared.session = null;
  shared.storedSession = null;
  let release!: () => void;
  shared.setupGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture();
  try {
    f.click();
    await until(() => shared.requests.length === 1);
    assert.equal(f.surface().props["aria-busy"], true);
    shared.owner = { connectionId: "local-A", profile: "default" };
    release();
    await until(() => shared.errors.length === 1);
    assert.match(shared.errors[0], /destination changed while checking setup/);
    assert.equal(shared.requests.length, 1);
    assert.equal(f.writes(), 0);
  } finally {
    release();
    f.dispose();
  }
});
