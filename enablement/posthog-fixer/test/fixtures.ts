import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../store.ts";
import type { Config } from "../config.ts";

export const issue = "11111111-1111-4111-a111-111111111111";
export const second = "22222222-2222-4222-a222-222222222222";
export const third = "33333333-3333-4333-a333-333333333333";
export const fourth = "44444444-4444-4444-a444-444444444444";
export function fixture(t: { after(fn: () => void): void }) {
  const directory = mkdtempSync(join(tmpdir(), "apparent-dev-posthog-test-"));
  const tokenFile = join(directory, "token");
  writeFileSync(tokenFile, "x".repeat(40), { mode: 0o600 });
  const c: Config = {
    projectId: 329943,
    t3ProjectId: "synthetic",
    t3Origin: "http://127.0.0.1:1",
    t3TokenFile: tokenFile,
    webhookTokenFile: tokenFile,
    stateDirectory: directory,
    posthogCommand: "/synthetic/posthog",
    posthogOrigin: "https://eu.posthog.com",
    port: 8646,
    dailyLimit: 1,
    queueLimit: 2,
    batchSize: 1,
    modelSelection: { instanceId: "codex", model: "synthetic" },
    runtimeMode: "auto-accept-edits",
  };
  let store = new Store(directory, "synthetic");
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    c,
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = new Store(directory, "synthetic");
      return store;
    },
  };
}
export function projected(thread: string, done = false, status = "running") {
  return {
    thread: {
      id: thread,
      projectId: "synthetic",
      settledAt: done ? "2026-11-15T12:00:00Z" : null,
    },
    runs: [{ id: "run", status }],
  };
}
