import { registerHooks } from "node:module";
import { shared } from "./sdk.ts";
import { sign, type Pending } from "../controller.ts";
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (["@hermes/plugin-sdk", "react/jsx-runtime"].includes(specifier))
      return {
        url: new URL("./sdk.ts", import.meta.url).href,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const plugin = (await import("../plugin.ts")).default;
hooks.deregister();
export async function until(predicate: () => unknown) {
  const deadline = Date.now() + 1500;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error("Async test condition did not settle");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
export function fixture(
  stored: unknown = null,
  delayedWrite: number | ((value: unknown) => boolean) = 0,
) {
  type Button = {
    props: {
      onClick: () => void;
      children: { type: string; props: { src: string } };
      "aria-busy"?: boolean;
    };
  };
  type Contribution = {
    id: string;
    render?: () => Button;
    data?: { run: () => Promise<void> };
  };
  let contribution: Contribution | undefined;
  let discard: Contribution | undefined;
  let interval: (() => void) | undefined;
  let saved: Pending | null | undefined;
  const history: unknown[] = [];
  let writes = 0;
  let startDelayedWrite!: () => void;
  let releaseDelayedWrite!: () => void;
  const delayedStarted = new Promise<void>((resolve) => {
    startDelayedWrite = resolve;
  });
  const delayedRelease = new Promise<void>((resolve) => {
    releaseDelayedWrite = resolve;
  });
  let dispose = () => {};
  const externalUrls: string[] = [];
  const ctx = {
    onDispose: (fn: () => void) => {
      dispose = fn;
    },
    os: {
      openExternal: async (url: string) => {
        externalUrls.push(url);
        return true;
      },
    },
    setInterval: (fn: () => void) => {
      interval = fn;
      return () => {
        interval = undefined;
      };
    },
    storage: {
      get: () => stored,
      set: async (_key: string, value: unknown) => {
        writes++;
        if (
          typeof delayedWrite === "number"
            ? writes === delayedWrite
            : delayedWrite(value)
        ) {
          startDelayedWrite();
          await delayedRelease;
        }
        saved = structuredClone(value) as Pending | null;
        history.push(structuredClone(value));
      },
    },
    register: (item: Contribution) => {
      if (item.id === "record") contribution = item;
      else discard = item;
    },
  };
  plugin.register(ctx);
  return {
    click: () => contribution!.render!().props.onClick(),
    surface: () => contribution!.render!(),
    discard: () => discard!.data!.run(),
    tick: () => interval?.(),
    saved: () => saved,
    watching: () => Boolean(interval),
    waitDelayedWrite: () => delayedStarted,
    releaseDelayedWrite,
    writes: () => writes,
    history: () => history,
    dispose: () => dispose(),
    externalUrls,
  };
}

export async function packet(
  phase: string,
  remoteSource: string | null = shared.source,
  bundlePath = shared.bundlePath,
) {
  const payload = JSON.stringify({
    phase,
    ...(phase === "saved" ? { bundlePath, remoteSource } : {}),
  });
  return Response.json({ payload, mac: await sign(shared.key, payload) });
}
export function reset() {
  shared.sessionCreateGate = undefined;
  shared.sessionCreateStart = undefined;
  shared.owner = { connectionId: "ssh-A", profile: "work" };
  shared.session = "runtime-A";
  shared.storedSession = "stored-A";
  shared.routes = [
    {
      connectionId: "ssh-A",
      profile: "work",
      targetProfile: "work",
      mode: "remote",
    },
    {
      connectionId: "local-A",
      profile: "default",
      targetProfile: "default",
      mode: "local",
    },
  ];
  shared.requests = [];
  shared.submissions = [];
  shared.errors = [];
  shared.insertions = [];
  shared.draftReads = [];
  shared.opens = [];
  shared.source = "cccccccccccccccccccccccccccccccc";
  shared.bundlePath = "/private/owned.apparent";
  shared.draft = "typed draft must remain unchanged";
  shared.acceptSubmit = true;
  shared.acceptInsert = true;
  shared.newDraft = "typed draft must remain unchanged";
  shared.draftReadGate = undefined;
  shared.draftReadStart = undefined;
  shared.sessionCreate = {
    session_id: "created-runtime",
    stored_session_id: "created-stored",
  };
  shared.legacyRuntimeDescribe = false;
  shared.runtimeDescribeError = undefined;
  shared.setupStatus = { schema: 1, status: "ready" };
  shared.setupRpcError = undefined;
  shared.setupGate = undefined;
  shared.shellSetupResult = {
    code: 0,
    stdout: '{"schema":1,"status":"ready"}',
    stderr: "",
  };
  shared.notices = [];
}
