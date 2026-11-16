// hermes/desktop/plugin.ts
import { host, COMPOSER_AREAS, PALETTE_AREA, Button, atom, useValue } from "@hermes/plugin-sdk";
import { jsx } from "react/jsx-runtime";

// hermes/desktop/controller.ts
var validToken = (value) => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
function validSource(value) {
  return typeof value === "string" && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value) && (validToken(value) || value.startsWith("/") && value.endsWith(".apparent"));
}
function validBundlePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value) && value.startsWith("/") && value.endsWith(".apparent");
}
function validRemoteSource(value) {
  return value === null || validToken(value);
}
function selectedSource(destination, bundlePath, remoteSource) {
  if (!validBundlePath(bundlePath) || !validRemoteSource(remoteSource)) return null;
  return destination.local ? bundlePath : remoteSource;
}
function recordCommand(token, port) {
  if (!validToken(token) || !Number.isInteger(port) || port < 32768 || port > 60999) throw new Error("Invalid recording request");
  return `apparent hermes record '${token}/${port}'`;
}
function keyCommand(token) {
  if (!validToken(token)) throw new Error("Invalid recording request");
  return `case "$(uname -s)" in Darwin) apparent_bridge_dir="$(getconf DARWIN_USER_TEMP_DIR)";; Linux) apparent_bridge_dir="\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}";; *) exit 64;; esac
cat "$apparent_bridge_dir/apparent-hermes/${token}.key"`;
}
function submission(destination, token, source) {
  if (!validToken(token) || !validSource(source) || !destination.local && !validToken(source)) throw new Error("Invalid recording delivery");
  return `Apparent recording (.apparent): ${source}
Use apparent_inspect with this exact source, then follow the make-it-apparent workflow. Inspect the complete recording, carry out my spoken instructions, and reply with a playable video of your work embedded or linked here. If you cannot provide one, say what blocked it and what you verified.`;
}
var hex = (bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
async function mailboxId(token) {
  if (!validToken(token)) throw new Error("Invalid mailbox capability");
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}
async function sign(secret, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}
async function authenticatedState(secret, packet) {
  const value = packet;
  if (!value || typeof value.payload !== "string" || value.payload.length > 24576 || typeof value.mac !== "string" || !/^[a-f0-9]{64}$/.test(value.mac)) throw new Error("Unauthenticated Apparent result");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(value.mac.match(/../g), (pair) => parseInt(pair, 16));
  if (!await crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(value.payload))) throw new Error("Unauthenticated Apparent result");
  return JSON.parse(value.payload);
}

// hermes/desktop/plugin.ts
var plugin_default = {
  id: "apparent",
  name: "Apparent",
  register(ctx) {
    let disposed = false;
    let working = false;
    let pending = null;
    let bridgeKey;
    let timer;
    const hasPending = atom(false);
    const save = () => {
      hasPending.set(Boolean(pending));
      return ctx.storage.set("recording", pending);
    };
    const report = (message) => {
      if (!disposed) host.notify({ kind: "error", message });
    };
    const unsupportedMethod = (error) => {
      const value = error;
      return value?.code === -32601 || value?.data?.reason === "unknown_method";
    };
    async function shellContract(route) {
      try {
        const described = await host.requestProfile(route, "runtime.describe", {});
        const create = described?.session_create;
        if (!Array.isArray(described?.capabilities) || !Array.isArray(create?.sources) || !Array.isArray(create?.parameters) || !create.sources.includes("gui") || !create.parameters.includes("request_id") || !create.parameters.includes("source")) throw new Error("Hermes returned an incomplete canonical runtime contract.");
        return { mode: "canonical", hidden: create.parameters.includes("hidden") };
      } catch (error) {
        if (unsupportedMethod(error)) return { mode: "legacy", hidden: false };
        throw error;
      }
    }
    async function ensureShellTarget(operation, route) {
      if (operation.shellMode) return;
      const contract = await shellContract(route);
      if (contract.mode === "legacy") {
        operation.shellMode = "legacy";
        await save();
        return;
      }
      if (operation.destination.local) {
        operation.shellMode = "canonical";
        operation.shellSession = operation.destination.session;
        await save();
        return;
      }
      if (!operation.helperRequestId) operation.helperRequestId = crypto.randomUUID().replaceAll("-", "");
      const beforeCreate = await host.profileRoutes();
      if (!beforeCreate.some((candidate) => candidate.connectionId === route.connectionId && candidate.profile === route.profile && candidate.targetProfile === route.targetProfile && candidate.mode === "local")) {
        throw new Error("The local recording route changed. The capture remains saved locally.");
      }
      await save();
      const createRoutes = await host.profileRoutes();
      if (!createRoutes.some((candidate) => candidate.connectionId === route.connectionId && candidate.profile === route.profile && candidate.targetProfile === route.targetProfile && candidate.mode === "local")) {
        throw new Error("The local recording route changed. The capture remains saved locally.");
      }
      const created = await host.requestProfile(route, "session.create", {
        request_id: operation.helperRequestId,
        source: "gui",
        ...contract.hidden ? { hidden: true } : {}
      });
      if (!created || typeof created.session_id !== "string" || !created.session_id || typeof created.stored_session_id !== "string" || !created.stored_session_id) {
        throw new Error("Hermes did not return a local shell session. The remote conversation was kept; no recording was started.");
      }
      operation.shellMode = "canonical";
      operation.shellSession = created.session_id;
      await save();
    }
    ctx.onDispose(() => {
      disposed = true;
      timer?.();
    });
    function destinationMatches(destination, routes) {
      const owner = host.state.focusedSessionOwner?.get();
      return !disposed && host.state.focusedSessionId?.get() === destination.session && host.state.focusedStoredSessionId?.get() === destination.storedSession && owner?.connectionId === destination.connectionId && owner?.profile === destination.profile && routes.some((route) => route.connectionId === destination.connectionId && route.profile === destination.profile && route.targetProfile === destination.targetProfile && route.mode === destination.mode);
    }
    async function destinationCurrent(destination) {
      return destinationMatches(destination, await host.profileRoutes());
    }
    async function newDraftCurrent(owner, route) {
      const routes = await host.profileRoutes();
      const focused = host.state.focusedSessionOwner?.get();
      return !disposed && !host.state.focusedSessionId?.get() && !host.state.focusedStoredSessionId?.get() && focused?.connectionId === owner.connectionId && focused?.profile === owner.profile && routes.some((candidate) => candidate.connectionId === route.connectionId && candidate.profile === route.profile && candidate.targetProfile === route.targetProfile && candidate.mode === route.mode);
    }
    async function local(operation, endpoint) {
      if (bridgeKey?.token !== operation.token) {
        const route = (await host.profileRoutes()).find((candidate) => candidate.connectionId === operation.localRoute.connectionId && candidate.profile === operation.localRoute.profile && candidate.targetProfile === operation.localRoute.targetProfile && candidate.mode === "local");
        if (!route) throw new Error("The local Apparent route is unavailable. The capture remains saved locally.");
        if (!operation.shellMode) await ensureShellTarget(operation, route);
        const currentRoutes = await host.profileRoutes();
        if (disposed || pending !== operation || !currentRoutes.some((candidate) => candidate.connectionId === operation.localRoute.connectionId && candidate.profile === operation.localRoute.profile && candidate.targetProfile === operation.localRoute.targetProfile && candidate.mode === "local")) {
          throw new Error("The local recording route changed. The capture remains saved locally.");
        }
        const params = operation.shellMode === "canonical" ? { session_id: operation.shellSession, command: keyCommand(operation.token) } : { command: keyCommand(operation.token) };
        const result = await host.requestProfile(route, "shell.exec", params);
        const key = result?.stdout?.trim();
        if (result?.code !== 0 || typeof key !== "string" || !validToken(key) || key === operation.token) throw new Error("Apparent recording bridge is unavailable");
        bridgeKey = { token: operation.token, value: key };
      }
      const secret = bridgeKey.value;
      const id = await mailboxId(operation.token);
      const suffix = `${endpoint}/${await sign(secret, `${endpoint}:${id}`)}`;
      const response = await fetch(`http://127.0.0.1:${operation.port}/${id}/${suffix}`, {
        method: endpoint === "ack" ? "POST" : "GET",
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(3e3)
      });
      if (!response.ok) throw new Error("Apparent recording bridge is unavailable");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Empty Apparent response");
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 32768) {
          await reader.cancel();
          throw new Error("Oversized Apparent response");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const packet = JSON.parse(new TextDecoder().decode(bytes));
      return endpoint === "state" ? authenticatedState(secret, packet) : packet;
    }
    async function poll() {
      if (disposed || working || !pending || pending.sending) return;
      working = true;
      const operation = pending;
      try {
        if (Date.now() - operation.created > 60 * 60 * 1e3 || Date.now() < operation.created) {
          pending = null;
          await save();
          throw new Error("Recording handoff expired. Your capture remains in Apparent.");
        }
        let state;
        try {
          state = await local(operation, "state");
        } catch (error) {
          if (operation.bundlePath && operation.remoteSource !== void 0) state = { phase: "saved", bundlePath: operation.bundlePath, remoteSource: operation.remoteSource };
          else if (Date.now() - operation.created < 3e4) return;
          else {
            throw error;
          }
        }
        if (disposed || pending !== operation) return;
        if (state.phase === "cancelled" || state.phase === "error") {
          await local(operation, "ack").catch(() => {
          });
          pending = null;
          await save();
          throw new Error(state.phase === "cancelled" ? "Recording cancelled. Nothing was sent." : state.code === "occupied" ? "Apparent is already recording or processing. Finish that capture before trying again." : "Apparent could not finish the recording. Open Apparent to inspect it.");
        }
        if (state.phase !== "saved" || !validBundlePath(state.bundlePath) || !validRemoteSource(state.remoteSource)) return;
        if (operation.bundlePath && operation.bundlePath !== state.bundlePath || operation.remoteSource !== void 0 && operation.remoteSource !== state.remoteSource) {
          throw new Error("Recording return changed. Nothing was sent again.");
        }
        const source = selectedSource(operation.destination, state.bundlePath, state.remoteSource);
        if (!source || !validSource(source) || operation.source && operation.source !== source) {
          if (!operation.destination.local && !state.remoteSource) {
            operation.bundlePath = state.bundlePath;
            operation.remoteSource = state.remoteSource;
            operation.source = void 0;
            operation.manual = true;
            await save();
            timer?.();
            timer = void 0;
            throw new Error("Recording saved locally. This remote conversation needs an existing Connect ID; no upload or read grant was enabled.");
          }
          throw new Error("Recording return changed. Nothing was sent again.");
        }
        operation.bundlePath = state.bundlePath;
        operation.remoteSource = state.remoteSource;
        operation.source = source;
        await save();
        if (disposed || pending !== operation || !await destinationCurrent(operation.destination)) return;
        if (!operation.destination.local && !validToken(source)) {
          timer?.();
          timer = void 0;
          throw new Error("Recording saved locally. This remote conversation needs an existing Connect ID; no upload or read grant was enabled.");
        }
        if (typeof host.composer?.getDraft !== "function" || typeof host.composer?.insertText !== "function" || typeof host.composer?.submit !== "function") {
          timer?.();
          timer = void 0;
          throw new Error("This Hermes Desktop SDK does not expose the supported composer draft APIs. The recording remains saved in Apparent.");
        }
        operation.sending = true;
        operation.manual = false;
        await save();
        if (disposed || pending !== operation) return;
        if (!await destinationCurrent(operation.destination)) {
          operation.sending = false;
          await save();
          return;
        }
        if (disposed || pending !== operation) return;
        const draft = await host.composer.getDraft(operation.destination.session);
        if (disposed || pending !== operation || !await destinationCurrent(operation.destination)) return;
        const text = submission(operation.destination, operation.token, source);
        const accepted = draft ? await host.composer.insertText(operation.destination.session, text, { mode: "block" }) : host.composer.submit(operation.destination.session, text);
        const stillVisibleAfterDispatch = await destinationCurrent(operation.destination);
        if (disposed || pending !== operation) return;
        if (!accepted) {
          operation.sending = false;
          operation.manual = true;
          await save();
          timer?.();
          timer = void 0;
          throw new Error("Hermes did not dispatch the recording handoff. Your source remains saved in Apparent for manual recovery.");
        }
        pending = null;
        await save();
        await local(operation, "ack").catch(() => {
        });
        if (!stillVisibleAfterDispatch) report("The handoff was placed in the pinned conversation composer, but focus changed afterward. Check that conversation before sending.");
      } catch (error) {
        timer?.();
        timer = void 0;
        report(error instanceof Error ? error.message : "Recording delivery failed. Check the original conversation.");
      } finally {
        working = false;
      }
    }
    function watch() {
      timer?.();
      timer = ctx.setInterval(() => void poll(), 2e3);
      void poll();
    }
    async function record() {
      if (disposed || working) return;
      if (pending) {
        if (!pending.sending) {
          const operation = pending;
          working = true;
          try {
            operation.manual = false;
            await save();
            if (!disposed && pending === operation) watch();
          } catch (error) {
            report(error instanceof Error ? error.message : "The saved handoff could not be prepared for retry.");
          } finally {
            working = false;
          }
        }
        return;
      }
      working = true;
      let launchMayHaveStarted = false;
      try {
        const owner = host.state.focusedSessionOwner?.get();
        const initialSession = host.state.focusedSessionId?.get() || null;
        const initialStored = host.state.focusedStoredSessionId?.get() || null;
        const isNewDraft = !initialSession && !initialStored;
        if (!owner || Boolean(initialSession) !== Boolean(initialStored)) throw new Error("Hermes does not expose a complete owner and session address for this composer. Nothing was started.");
        if (typeof host.composer?.getDraft !== "function" || typeof host.composer?.insertText !== "function" || typeof host.composer?.submit !== "function") {
          throw new Error("This Hermes Desktop SDK does not expose the supported composer draft APIs.");
        }
        if (isNewDraft && (typeof host.requestProfile !== "function" || typeof host.openSession !== "function")) {
          throw new Error("This Hermes Desktop SDK cannot create and open a pinned conversation from a fresh draft. Nothing was started.");
        }
        const routes = await host.profileRoutes();
        const ownerAfterRoutes = host.state.focusedSessionOwner?.get();
        if (disposed || host.state.focusedSessionId?.get() !== initialSession || host.state.focusedStoredSessionId?.get() !== initialStored || ownerAfterRoutes?.connectionId !== owner.connectionId || ownerAfterRoutes?.profile !== owner.profile) {
          throw new Error("The destination changed while preparing recording. Nothing was started.");
        }
        const destinations = routes.filter((route) => route.connectionId === owner.connectionId && route.profile === owner.profile);
        if (destinations.length !== 1) throw new Error("The conversation\u2019s gateway route is ambiguous or unavailable.");
        const destinationRoute = destinations[0];
        if (!destinationRoute.targetProfile || !destinationRoute.mode) throw new Error("Hermes does not expose a complete route for this conversation.");
        const localRoutes = routes.filter((route) => route.mode === "local");
        if (localRoutes.length !== 1 || !localRoutes[0].targetProfile) throw new Error("Hermes does not expose one unambiguous local recording route.");
        let session = initialSession;
        let storedSession = initialStored;
        if (isNewDraft) {
          const originalDraft = await host.composer.getDraft("new");
          if (!await newDraftCurrent(owner, destinationRoute)) throw new Error("The fresh composer changed while reading its draft. Nothing was started.");
          const requestId = crypto.randomUUID().replaceAll("-", "");
          const created = await host.requestProfile(destinationRoute, "session.create", { request_id: requestId, source: "gui" });
          if (!await newDraftCurrent(owner, destinationRoute)) throw new Error("The fresh composer changed while binding a conversation. No recording was started.");
          if (!created || typeof created.session_id !== "string" || !created.session_id || typeof created.stored_session_id !== "string" || !created.stored_session_id) {
            throw new Error("Hermes did not return both runtime and stored IDs for the new conversation. Nothing was started.");
          }
          const routeStillCurrent = await newDraftCurrent(owner, destinationRoute);
          const latestDraft = await host.composer.getDraft("new");
          const latestOwner = host.state.focusedSessionOwner?.get();
          if (!routeStillCurrent || disposed || latestDraft !== originalDraft || host.state.focusedSessionId?.get() || host.state.focusedStoredSessionId?.get() || latestOwner?.connectionId !== owner.connectionId || latestOwner?.profile !== owner.profile) {
            throw new Error("The fresh draft changed while creating the conversation. Your text was kept; no recording was started.");
          }
          await host.openSession(created.stored_session_id, { route: destinationRoute, awaitHydration: true, expectHistory: false });
          session = host.state.focusedSessionId?.get();
          storedSession = host.state.focusedStoredSessionId?.get();
          if (!session || storedSession !== created.stored_session_id) throw new Error("Hermes did not bind the created conversation to the visible composer. Nothing was started.");
          const createdDestination = {
            session,
            storedSession,
            connectionId: owner.connectionId,
            profile: owner.profile,
            targetProfile: destinationRoute.targetProfile,
            mode: destinationRoute.mode,
            local: destinationRoute.mode === "local"
          };
          if (!await destinationCurrent(createdDestination)) throw new Error("The created conversation is no longer the visible destination. Nothing was started.");
          const openedDraft = await host.composer.getDraft(session);
          if (!await destinationCurrent(createdDestination)) throw new Error("The destination changed while checking its typed draft. Nothing was started.");
          if (originalDraft && openedDraft !== originalDraft) {
            if (openedDraft) throw new Error("The new conversation already has different typed text; nothing was replaced and recording did not start.");
            const retained = await host.composer.insertText(session, originalDraft, { mode: "block" });
            if (!await destinationCurrent(createdDestination)) throw new Error("The conversation changed while preserving its typed draft. No recording was started.");
            if (!retained) throw new Error("Hermes could not preserve the typed draft in the created conversation. Nothing was started.");
          }
        }
        if (!session || !storedSession) throw new Error("A saved conversation could not be pinned safely. Nothing was started.");
        const destination = {
          session,
          storedSession,
          connectionId: owner.connectionId,
          profile: owner.profile,
          targetProfile: destinationRoute.targetProfile,
          mode: destinationRoute.mode,
          local: destinationRoute.mode === "local"
        };
        if (!await destinationCurrent(destination)) throw new Error("The destination changed before recording. Nothing was started.");
        const bytes = crypto.getRandomValues(new Uint32Array(1));
        bridgeKey = void 0;
        pending = {
          version: 4,
          token: crypto.randomUUID().replaceAll("-", ""),
          port: 32768 + bytes[0] % (60999 - 32768 + 1),
          destination,
          localRoute: { connectionId: localRoutes[0].connectionId, profile: localRoutes[0].profile, targetProfile: localRoutes[0].targetProfile },
          created: Date.now()
        };
        await save();
        if (disposed || pending === null) return;
        const currentRoutes = await host.profileRoutes();
        if (disposed || pending === null) return;
        if (!destinationMatches(destination, currentRoutes)) {
          pending = null;
          await save();
          return;
        }
        const localRoute = currentRoutes.find((route) => route.connectionId === pending.localRoute.connectionId && route.profile === pending.localRoute.profile && route.targetProfile === pending.localRoute.targetProfile && route.mode === "local");
        if (!localRoute) throw new Error("The local recording route changed. Nothing was started.");
        await ensureShellTarget(pending, localRoute);
        if (disposed || !pending) return;
        const launchRoutes = await host.profileRoutes();
        if (!destinationMatches(destination, launchRoutes) || !launchRoutes.some((route) => route.connectionId === pending.localRoute.connectionId && route.profile === pending.localRoute.profile && route.targetProfile === pending.localRoute.targetProfile && route.mode === "local")) {
          throw new Error("The destination or local recording route changed. Nothing was started.");
        }
        launchMayHaveStarted = true;
        const shellParams = pending.shellMode === "canonical" ? { session_id: pending.shellSession, command: recordCommand(pending.token, pending.port) } : { command: recordCommand(pending.token, pending.port) };
        const result = await host.requestProfile(localRoute, "shell.exec", shellParams);
        if (result?.code !== 0) throw new Error("Apparent could not start the recording. Check the local app and its permissions.");
        if (!disposed) watch();
      } catch (error) {
        if (launchMayHaveStarted && pending) {
          if (!disposed) watch();
        } else {
          pending = null;
          await save();
        }
        report(error instanceof Error ? error.message : "Unable to start Apparent");
      } finally {
        working = false;
      }
    }
    Promise.resolve(ctx.storage.get("recording")).then(async (value) => {
      if (disposed || pending || !value) return;
      if (value.version !== 3 && value.version !== 4) {
        await ctx.storage.set("recording", null);
        report("This older recording handoff cannot resume safely. Copy its recording from Apparent into Hermes.");
        return;
      }
      if (typeof value.token !== "string" || !validToken(value.token) || !Number.isInteger(value.port) || value.port < 32768 || value.port > 60999 || !Number.isFinite(value.created)) return;
      if (!value.destination || !["session", "storedSession", "connectionId", "profile", "targetProfile", "mode"].every((key) => typeof value.destination[key] === "string" && value.destination[key]) || typeof value.destination.local !== "boolean") return;
      if (!value.localRoute || !["connectionId", "profile", "targetProfile"].every((key) => typeof value.localRoute[key] === "string" && value.localRoute[key])) return;
      if (value.shellMode !== void 0 && value.shellMode !== "legacy" && value.shellMode !== "canonical") return;
      if (value.shellSession !== void 0 && (typeof value.shellSession !== "string" || !value.shellSession)) return;
      if (value.helperRequestId !== void 0 && (typeof value.helperRequestId !== "string" || !/^[a-f0-9]{32}$/.test(value.helperRequestId))) return;
      if (value.shellMode === "canonical" && !value.shellSession) {
        pending = { ...value, manual: true };
        hasPending.set(true);
        report("The saved recording has no persisted local shell session identity. It remains available in Apparent for manual recovery.");
        return;
      }
      if (value.manual !== void 0 && typeof value.manual !== "boolean") return;
      if (value.source !== void 0 && !validSource(value.source)) return;
      if (value.version === 3) {
        const legacySource = typeof value.source === "string" ? value.source : void 0;
        value = {
          ...value,
          version: 4,
          source: value.destination.local ? void 0 : legacySource && validToken(legacySource) ? legacySource : void 0,
          remoteSource: legacySource && validToken(legacySource) ? legacySource : void 0
        };
        await ctx.storage.set("recording", value);
      }
      if (value.bundlePath !== void 0 && !validBundlePath(value.bundlePath)) return;
      if (value.remoteSource !== void 0 && !validRemoteSource(value.remoteSource)) return;
      pending = value;
      hasPending.set(true);
      if (pending.sending) report("Hermes may have dispatched this recording before its last reply. Check the original conversation; the plugin will not send it again automatically.");
      else if (pending.manual) report("The recording was not dispatched. Its source remains saved in Apparent for manual recovery.");
      else if (pending.destination.local || pending.shellSession || pending.shellMode === "legacy") watch();
      else {
        if (!pending.helperRequestId) pending.helperRequestId = crypto.randomUUID().replaceAll("-", "");
        await save();
        watch();
      }
    }).catch(() => {
    });
    function RecordButton() {
      const waiting = useValue(hasPending);
      const label = pending?.manual ? "Retry saved Apparent handoff" : waiting ? "Check Apparent recording handoff" : "Record with Apparent";
      return jsx(Button, {
        type: "button",
        variant: "ghost",
        size: "icon",
        title: label,
        "aria-label": label,
        onClick: () => void record(),
        children: jsx("img", { src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIiByb2xlPSJpbWciIGFyaWEtbGFiZWxsZWRieT0idGl0bGUgZGVzYyI+CiAgPHRpdGxlIGlkPSJ0aXRsZSI+YXBwYXJlbnQgaWNvbjogTGlsYWMgb24gQ2FyYm9uPC90aXRsZT4KICA8ZGVzYyBpZD0iZGVzYyI+Qm9sZCBsb3dlcmNhc2UgYSBpbiBMaWxhYyBpbnNpZGUgYSBDYXJib24gc3F1YXJlLCBmb3IgdXNlIG9uIExpbGFjIGJhY2tncm91bmRzLjwvZGVzYz4KICA8cmVjdCB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgZmlsbD0iIzAyMDEwMiIvPgogIDxwYXRoIGZpbGw9IiNCN0E1RDgiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDUwLjA4IDQzNC41Nikgc2NhbGUoLjcyIC0uNzIpIiBkPSJNMjExIC0xMlExNTUgLTEyIDExNC41IDhRNzQgMjggNTMgNjJRMzIgOTYgMzIgMTM3UTMyIDIxNSA4OCAyNTcuNVExNDQgMzAwIDIzNSAzMDBRMjc4IDMwMCAzMDkgMjk0UTM0MCAyODggMzYwIDI4MUwzNjAgMzA1UTM2MCAzNTcgMzMwLjUgMzgxUTMwMSA0MDUgMjU0IDQwNVEyMjEgNDA1IDE5NSAzOTEuNVExNjkgMzc4IDE2MiAzNDRMMzkgMzQ0UTQ1IDM5NyA3NSA0MzMuNVExMDUgNDcwIDE1MS41IDQ4OVExOTggNTA4IDI1NCA1MDhRMzY1IDUwOCA0MjcuNSA0NTVRNDkwIDQwMiA0OTAgMzA1TDQ5MCAxOTNRNDkwIDE1NSA0OTQuNSAxMzdRNDk5IDExOSA1MDkgMTE0UTUxOSAxMDkgNTM2IDEwOUw1NDAgMTA5TDU0MCAwTDUxMiAwUTQ1OSAwIDQyNCAxNFEzODkgMjggMzczIDY5UTM0OCAzNCAzMDcgMTFRMjY2IC0xMiAyMTEgLTEyWk0yNDAgODdRMjcyIDg3IDI5NC41IDEwMS41UTMxNyAxMTYgMzMyIDE0MS41UTM0NyAxNjcgMzUzIDE5N1EzMzIgMjAzIDMwNC41IDIwOC41UTI3NyAyMTQgMjQ5IDIxNFEyMTAgMjE0IDE4Ni41IDE5Ni41UTE2MyAxNzkgMTYzIDE0OFExNjMgMTIxIDE4My41IDEwNFEyMDQgODcgMjQwIDg3WiIvPgo8L3N2Zz4K", width: 20, height: 20, alt: "" })
      });
    }
    ctx.register({ id: "record", area: COMPOSER_AREAS.actions, render: RecordButton });
    ctx.register({ id: "discard", area: PALETTE_AREA, data: {
      id: "apparent-discard-handoff",
      label: "Apparent: discard pending handoff",
      keywords: ["recording", "cancel"],
      detail: () => pending ? "Recording retained in Apparent" : "No pending handoff",
      run: async () => {
        if (!pending || working) return;
        const operation = pending;
        pending = null;
        timer?.();
        timer = void 0;
        await save();
        await local(operation, "ack").catch(() => {
        });
      }
    } });
  }
};
export {
  plugin_default as default
};
