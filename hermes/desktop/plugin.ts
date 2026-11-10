import { host, COMPOSER_AREAS, PALETTE_AREA, Button, atom, useValue } from '@hermes/plugin-sdk';
import { jsx } from 'react/jsx-runtime';
import { recordCommand, captureInspectCommand, captureHandoffCommand, keyCommand, submission, validSource, validToken, mailboxId, sign, authenticatedState, runtime, sameRuntime, type Pending } from './controller.ts';
export default {
  id: 'apparent', name: 'Apparent',
  register(ctx) {
    let disposed = false;
    let working = false;
    let pending: Pending | null = null;
    let bridgeKey: { token: string; value: string } | undefined;
    let timer: (() => void) | undefined;
    let draftMoved = false;
    const draftKey = () => globalThis.localStorage?.getItem('hermes.desktop.freshDraftKey') || '__new__';
    const observeDraft = () => {
      if (!pending?.draftKey) return;
      const owner = host.state.focusedSessionOwner?.get();
      if (host.state.focusedSessionId?.get() || host.state.focusedStoredSessionId?.get() || owner?.connectionId !== pending.destination.connectionId || owner?.profile !== pending.destination.profile) draftMoved = true;
    };
    const draftStops = [host.state.focusedSessionId, host.state.focusedSessionOwner, host.state.focusedStoredSessionId]
      .map(value => value?.listen?.(observeDraft)).filter(Boolean) as Array<() => void>;
    const hasPending = atom(false);
    const save = () => { hasPending.set(Boolean(pending)); return ctx.storage.set('recording', pending); };
    const report = (message: string) => { if (!disposed) host.notify({ kind: 'error', message }); };
    ctx.onDispose(() => { disposed = true; timer?.(); draftStops.forEach(stop => stop()); });
    async function signingKey(operation: Pending) {
      if (bridgeKey?.token === operation.token) return bridgeKey.value;
      const route = (await host.profileRoutes()).find(r => r.connectionId === operation.localRoute.connectionId && r.profile === operation.localRoute.profile);
      if (!route || route.mode !== 'local' || route.targetProfile !== operation.localRoute.targetProfile) throw new Error('The local recording connection changed. Nothing was sent.');
      const release = await host.retainProfile(route, { spawnPriority: 'foreground' });
      try {
        if (disposed || (pending !== operation && !operation.source)) throw new Error('Handoff is no longer active');
        if (!sameRuntime(operation.localRuntime, runtime(await host.requestProfile(route, 'runtime.describe', {})))) throw new Error('The local recording runtime changed. Nothing was sent.');
        const snapshot = await host.requestProfile(route, 'session.resume', { session_id: operation.helper });
        if (snapshot?.session_id !== operation.helper || snapshot.authority_epoch !== operation.localRuntime.authority_epoch) throw new Error('The local recording helper changed. Nothing was sent.');
        if (disposed || (pending !== operation && !operation.source)) throw new Error('Handoff is no longer active');
        const result = await host.requestProfile(route, 'shell.exec', { session_id: operation.helper, command: keyCommand(operation.token) });
        const key = result?.stdout?.trim();
        if (result?.code !== 0 || !validToken(key) || key === operation.token) throw new Error('Apparent recording bridge is unavailable');
        if (disposed || (pending !== operation && !operation.source)) throw new Error('Handoff is no longer active');
        bridgeKey = { token: operation.token, value: key };
        return key;
      } finally { release(); }
    }
    async function local(path: 'state' | 'ack', operation: Pending) {
      const key = await signingKey(operation);
      const id = await mailboxId(operation.token);
      const suffix = `${path}/${await sign(key, `${path}:${id}`)}`;
      const response = await fetch(`http://127.0.0.1:${operation.port}/${id}/${suffix}`, {
        method: path === 'ack' ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error('Apparent recording bridge is unavailable');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty Apparent response');
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
        if (size > 32768) { await reader.cancel(); throw new Error('Oversized Apparent response'); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const packet = JSON.parse(new TextDecoder().decode(bytes));
      return path === 'state' ? authenticatedState(key, packet) : packet;
    }
    async function localShell(operation: Pending, command: string) {
      const route = (await host.profileRoutes()).find(r => r.connectionId === operation.localRoute.connectionId && r.profile === operation.localRoute.profile);
      if (!route || route.mode !== 'local' || route.targetProfile !== operation.localRoute.targetProfile) throw new Error('The local recording connection changed. Recording retained.');
      const release = await host.retainProfile(route, { spawnPriority: 'foreground' });
      try {
        if (!sameRuntime(operation.localRuntime, runtime(await host.requestProfile(route, 'runtime.describe', {})))) throw new Error('The local recording runtime changed. Recording retained.');
        const snapshot = await host.requestProfile(route, 'session.resume', { session_id: operation.helper });
        if (snapshot?.session_id !== operation.helper || snapshot.authority_epoch !== operation.localRuntime.authority_epoch) throw new Error('The local recording helper changed. Recording retained.');
        if (disposed) throw new Error('Recording handoff is no longer active.');
        const result = await host.requestProfile(route, 'shell.exec', { session_id: operation.helper, command });
        if (result?.code !== 0) throw new Error(`Apparent capture lookup failed: ${String(result?.stderr || result?.stdout || '').slice(0, 200)}`);
        return String(result.stdout || '').trim();
      } finally { release(); }
    }
    async function refreshedSource(operation: Pending) {
      const inspected = JSON.parse(await localShell(operation, captureInspectCommand(operation.token)));
      if (inspected?.capture_id !== operation.token || inspected.status !== 'saved' || !validSource(inspected.bundle_path) || validToken(inspected.bundle_path)) throw new Error('The exact local capture is not saved yet. Recording retained.');
      const handed = JSON.parse(await localShell(operation, captureHandoffCommand(operation.token)));
      if (handed?.capture_id !== operation.token || !validSource(handed.source)) throw new Error('Apparent did not return this capture handoff. Recording retained.');
      return { inspected, source: handed.source as string };
    }
    async function poll() {
      if (disposed || working || !pending) return;
      working = true;
      const operation = pending;
      let releaseRoute = () => {};
      try {
        if (Date.now() - operation.created > 60 * 60 * 1000 || Date.now() < operation.created) {
          pending = null; await save(); throw new Error('Recording handoff expired. Your capture remains in Apparent; nothing was sent again.');
        }
        let state;
        try { state = operation.source && !operation.retrySource ? { phase: 'saved', source: operation.source } : await local('state', operation); }
        catch (error) {
          if (operation.source) state = { phase: 'saved', source: operation.source };
          else if (Date.now() - operation.created < 30000) return;
          else { pending = null; await save(); throw error; }
        }
        if (disposed || pending !== operation) return;
        if (state.phase === 'cancelled' || state.phase === 'error') {
          await local('ack', operation).catch(() => {});
          pending = null; await save(); throw new Error(state.phase === 'cancelled' ? 'Recording cancelled. Nothing was sent.' : state.code === 'occupied' ? 'Apparent is already recording or processing. Finish that capture before trying again.' : 'Apparent could not finish the recording. Open Apparent to inspect it.');
        }
        if (state.phase !== 'saved' || !validSource(state.source)) return;
        if (operation.retrySource || (operation.destination.local && validToken(state.source))) {
          const latest = await refreshedSource(operation);
          state = { ...state, source: operation.destination.local ? latest.inspected.bundle_path : latest.source };
        }
        if (operation.source && operation.source !== state.source && !operation.retrySource) throw new Error('Recording return changed. Nothing was resent.');
        operation.source = state.source;
        operation.retrySource = false;
        await save();
        if (disposed) return;
        // Submit through the originating registry connection, never the current foreground gateway.
        // Both retries use the same input identity and exact text; the authority deduplicates input_id.
        const route = (await host.profileRoutes()).find(r => r.connectionId === operation.destination.connectionId && r.profile === operation.destination.profile);
        if (!route) throw new Error('The original Hermes gateway is unavailable. Recording saved; nothing was redirected.');
        if (route.targetProfile !== operation.destination.targetProfile || route.mode !== operation.destination.mode) throw new Error('The original Hermes gateway mapping changed. Nothing was sent.');
        if (typeof host.retainProfile !== 'function') throw new Error('Hermes lacks a retained session connection. Update Hermes before sending this recording.');
        releaseRoute = await host.retainProfile(route, { spawnPriority: 'foreground' });
        const identity = runtime(await host.requestProfile(route, 'runtime.describe', {}));
        if (!sameRuntime(operation.runtime, identity)) throw new Error('The original Hermes runtime changed. Check the saved recording; nothing was redirected.');
        if (disposed) return;
        const params = submission(operation.destination, operation.token, state.source);
        // prompt.submit requires this socket to hold a subscription. Exact ID only;
        // no title/latest/create path, and no cwd/provider/settings overrides.
        if (!operation.destination.session) {
          const owner = host.state.focusedSessionOwner?.get();
          if (!operation.draftKey || draftMoved || draftKey() !== operation.draftKey || host.state.focusedSessionId?.get() || host.state.focusedStoredSessionId?.get() || owner?.connectionId !== operation.destination.connectionId || owner?.profile !== operation.destination.profile) throw new Error('The original new-chat draft changed. Recording retained. Click Apparent in the intended draft to retry.');
          const afterRoute = (await host.profileRoutes()).find(r => r.connectionId === operation.destination.connectionId && r.profile === operation.destination.profile);
          const afterRuntime = afterRoute ? runtime(await host.requestProfile(afterRoute, 'runtime.describe', {})) : undefined;
          const currentDraft = await host.composer.getDraft('new');
          const afterOwner = host.state.focusedSessionOwner?.get();
          if (disposed || draftMoved || draftKey() !== operation.draftKey || host.state.focusedSessionId?.get() || host.state.focusedStoredSessionId?.get() || afterOwner?.connectionId !== operation.destination.connectionId || afterOwner?.profile !== operation.destination.profile || !afterRoute || afterRoute.mode !== operation.destination.mode || afterRoute.targetProfile !== operation.destination.targetProfile || !afterRuntime || !sameRuntime(operation.runtime, afterRuntime)) throw new Error('The original new-chat draft changed. Recording retained.');
          if (currentDraft?.trim()) {
            if (!await host.composer.insertText('new', params.text, { mode: 'block' })) throw new Error('Could not add the recording to the current draft. Recording retained.');
            pending = null; await save(); await local('ack', operation).catch(() => {});
            if (!disposed) host.notify({ kind: 'info', message: 'Recording details added to your draft. Review and send when ready.' });
            return;
          }
          if (!host.composer.submit('new', params.text)) throw new Error('Hermes could not submit the original draft. Recording retained.');
          pending = null; await save(); await local('ack', operation).catch(() => {});
          if (!disposed) host.notify({ kind: 'info', message: 'Recording submitted to the new conversation.' });
          return;
        }
        const snapshot = await host.requestProfile(route, 'session.resume', { session_id: operation.destination.session });
        if (snapshot?.session_id !== operation.destination.session || snapshot.authority_epoch !== operation.runtime.authority_epoch) throw new Error('The original session identity changed. Nothing was sent.');
        operation.sending = true; await save();
        if (disposed) return;
        let receipt;
        for (let attempt = 0; attempt < 2; attempt++) {
          if (disposed) return;
          try { receipt = await host.requestProfile(route, 'prompt.submit', params); break; }
          catch (error) { if (attempt === 1) throw error; }
        }
        if (!receipt?.admission_id) throw new Error('Hermes did not acknowledge this message. Check the original conversation before trying again.');
        // Clear before acknowledgement so a missing native ACK cannot create another submission.
        pending = null; await save();
        await local('ack', operation).catch(() => {});
        if (!disposed) host.notify({ kind: 'success', message: 'Recording sent to the original conversation.' });
      } catch (error) {
        // Preserve a saved source for recovery, but stop automatic retries after a delivery error.
        timer?.(); timer = undefined;
        if (!operation.source && !operation.sending && pending === operation) { pending = null; await save(); }
        report(error instanceof Error ? error.message : 'Recording delivery failed. Check the original conversation.');
      } finally { releaseRoute(); working = false; }
    }
    function watch() { timer?.(); timer = ctx.setInterval(() => void poll(), 2000); void poll(); }
    async function record() {
      if (disposed || working) return;
      if (pending) {
        if (pending.source && !pending.destination.local) pending.retrySource = true;
        if (!pending.destination.session && (pending.source || pending.paused) && pending.destination.connectionId === host.state.focusedSessionOwner?.get()?.connectionId && pending.destination.profile === host.state.focusedSessionOwner?.get()?.profile && !host.state.focusedSessionId?.get() && !host.state.focusedStoredSessionId?.get()) {
          pending.draftKey = draftKey(); pending.paused = false; draftMoved = false; await save();
        }
        watch(); return;
      }
      working = true;
      let launchMayHaveStarted = false;
      try {
        const owner = host.state.focusedSessionOwner?.get();
        const session = host.state.focusedSessionId?.get();
        if (!owner || typeof host.requestProfile !== 'function' || typeof host.retainProfile !== 'function') throw new Error('Open a Hermes conversation or draft. This button requires the SDK’s connection-qualified session API.');
        const destinationKey = { connectionId: owner.connectionId, profile: owner.profile };
        const initialDraftKey = session ? undefined : draftKey();
        if (!session && document.querySelectorAll('[data-slot="composer-rich-input"]').length !== 1) throw new Error('Keep one new-chat composer visible while recording.');
        draftMoved = false;
        const routes = (await host.profileRoutes()).filter(r => r.connectionId === destinationKey.connectionId && r.profile === destinationKey.profile);
        if (routes.length !== 1) throw new Error('The conversation’s gateway is ambiguous or unavailable.');
        if (typeof routes[0].targetProfile !== 'string' || typeof routes[0].mode !== 'string') throw new Error('Hermes lacks a complete conversation route. Update Hermes before recording.');
        const identity = runtime(await host.requestProfile(routes[0], 'runtime.describe', {}));
        const ownerAfterIdentity = host.state.focusedSessionOwner?.get();
        if (disposed || host.state.focusedSessionId?.get() !== session || ownerAfterIdentity?.connectionId !== destinationKey.connectionId || ownerAfterIdentity?.profile !== destinationKey.profile || (!session && (host.state.focusedStoredSessionId?.get() || draftKey() !== initialDraftKey))) throw new Error('The destination changed while preparing recording. Nothing was started.');
        if (disposed) return;
        const allRoutes = await host.profileRoutes();
        const localRoute = allRoutes.find(r => r.mode === 'local' && r.profile === 'default') || allRoutes.find(r => r.mode === 'local');
        if (!localRoute) throw new Error('Hermes has no local recording connection.');
        const localRuntime = runtime(await host.requestProfile(localRoute, 'runtime.describe', {}));
        const bytes = crypto.getRandomValues(new Uint32Array(1));
        bridgeKey = undefined;
        const token = crypto.randomUUID().replaceAll('-', '');
        const helper = await host.requestProfile(localRoute, 'session.create', { source: 'desktop', cols: 80, request_id: token });
        if (!helper?.session_id) throw new Error('Hermes could not prepare the local recording helper.');
        const ownerAfterHelper = host.state.focusedSessionOwner?.get();
        if (disposed || host.state.focusedSessionId?.get() !== session || ownerAfterHelper?.connectionId !== destinationKey.connectionId || ownerAfterHelper?.profile !== destinationKey.profile || (!session && (host.state.focusedStoredSessionId?.get() || draftKey() !== initialDraftKey))) throw new Error('The destination changed while preparing recording. Nothing was started.');
        pending = { version: 3, token, port: 32768 + bytes[0] % (60999 - 32768 + 1), destination: { session: session || '', connectionId: destinationKey.connectionId, profile: destinationKey.profile, targetProfile: routes[0].targetProfile, mode: routes[0].mode, local: routes[0].mode === 'local' }, runtime: identity, localRoute: { connectionId: localRoute.connectionId, profile: localRoute.profile, targetProfile: localRoute.targetProfile }, localRuntime, helper: helper.session_id, draftKey: initialDraftKey, created: Date.now() };
        await save();
        if (disposed) return;
        const operation = pending;
        const route = allRoutes.find(r => r.connectionId === localRoute.connectionId && r.profile === localRoute.profile);
        if (!route || route.mode !== 'local' || route.targetProfile !== localRoute.targetProfile) throw new Error('The local recording connection changed. Nothing was launched.');
        const release = await host.retainProfile(route, { spawnPriority: 'foreground' });
        try {
          if (!sameRuntime(operation.localRuntime, runtime(await host.requestProfile(route, 'runtime.describe', {})))) throw new Error('The local recording runtime changed. Nothing was launched.');
          const snapshot = await host.requestProfile(route, 'session.resume', { session_id: operation.helper });
          if (snapshot?.session_id !== operation.helper || snapshot.authority_epoch !== operation.localRuntime.authority_epoch) throw new Error('The local recording helper changed. Nothing was launched.');
          if (!session) {
            const currentOwner = host.state.focusedSessionOwner?.get();
            if (disposed || draftMoved || draftKey() !== operation.draftKey || host.state.focusedSessionId?.get() || host.state.focusedStoredSessionId?.get() || currentOwner?.connectionId !== destinationKey.connectionId || currentOwner?.profile !== destinationKey.profile) throw new Error('The destination draft changed while preparing recording. Nothing was started.');
            const destinationRoute = (await host.profileRoutes()).find(r => r.connectionId === destinationKey.connectionId && r.profile === destinationKey.profile);
            if (!destinationRoute || destinationRoute.mode !== operation.destination.mode || destinationRoute.targetProfile !== operation.destination.targetProfile || !sameRuntime(operation.runtime, runtime(await host.requestProfile(destinationRoute, 'runtime.describe', {})))) throw new Error('The destination gateway changed while preparing recording. Nothing was started.');
            const finalOwner = host.state.focusedSessionOwner?.get();
            if (disposed || draftMoved || draftKey() !== operation.draftKey || host.state.focusedSessionId?.get() || host.state.focusedStoredSessionId?.get() || finalOwner?.connectionId !== destinationKey.connectionId || finalOwner?.profile !== destinationKey.profile) throw new Error('The destination draft changed while preparing recording. Nothing was started.');
          }
          launchMayHaveStarted = true;
          const result = await host.requestProfile(route, 'shell.exec', { session_id: operation.helper, command: recordCommand(operation.token, operation.port) });
          if (result?.code !== 0) throw new Error('Unable to start Apparent. Install its CLI on this computer.');
        } finally { release(); }
        launchMayHaveStarted = true;
        if (!disposed) watch();
      } catch (error) {
        // An RPC timeout cannot establish that the OS did not open the helper.
        if (launchMayHaveStarted && pending) { if (!disposed) watch(); }
        else { pending = null; await save(); }
        report(error instanceof Error ? error.message : 'Unable to open Apparent');
      }
      finally { working = false; }
    }
    // No credentials or recording media are stored here; only an owned in-flight operation.
    Promise.resolve(ctx.storage.get('recording')).then(async value => {
      if (disposed || pending || !value) return;
      if (value.version !== 3) { await ctx.storage.set('recording', null); report('This older recording handoff cannot resume safely. Copy its recording from Apparent into Hermes.'); return; }
      if (!validToken(value.token)) return;
      if (!Number.isInteger(value.port) || value.port < 32768 || value.port > 60999 || !Number.isFinite(value.created) ||
          !value.runtime || !value.destination || typeof value.destination.local !== 'boolean' || !['session', 'connectionId', 'profile', 'targetProfile', 'mode'].every(k => typeof value.destination[k] === 'string') || (!value.destination.session && typeof value.draftKey !== 'string')) return;
      runtime(value.runtime);
      if (!value.localRoute || typeof value.localRoute.connectionId !== 'string' || typeof value.localRoute.profile !== 'string' || typeof value.localRoute.targetProfile !== 'string' || typeof value.helper !== 'string') return;
      runtime(value.localRuntime);
      pending = { ...value, ...(value.destination.session ? {} : { paused: true }) }; hasPending.set(true);
      if (pending.destination.session) watch();
    }).catch(() => {});
    function RecordButton() {
      const waiting = useValue(hasPending);
      const label = waiting ? 'Check Apparent recording handoff' : 'Record with Apparent';
      return jsx(Button, { variant: 'ghost', size: 'icon', title: label, 'aria-label': label,
        onClick: () => void record(), children: jsx('img', { src: '__APPARENT_ICON__', width: 20, height: 20, alt: '' }) });
    }
    ctx.register({ id: 'record', area: COMPOSER_AREAS.actions, render: RecordButton });
    ctx.register({ id: 'discard', area: PALETTE_AREA, data: {
      id: 'apparent-discard-handoff', label: 'Apparent: discard pending handoff', keywords: ['recording', 'cancel'],
      detail: () => pending ? 'Recording retained in Apparent' : 'No pending handoff',
      run: async () => {
        if (!pending || working) return;
        const operation = pending; pending = null; timer?.(); timer = undefined; await save();
        if (operation.source) await local('ack', operation).catch(() => {});
        if (!disposed) host.notify({ kind: 'info', message: 'Handoff discarded. The recording remains in Apparent.' });
      },
    } });
  },
};
