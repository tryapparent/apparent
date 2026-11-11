import { host, COMPOSER_AREAS, PALETTE_AREA, Button, Codicon, atom, useValue } from '@hermes/plugin-sdk';
import { jsx } from 'react/jsx-runtime';
import { recordCommand, keyCommand, submission, validSource, validToken, mailboxId, sign, authenticatedState, type Pending } from './controller.ts';

export default {
  id: 'apparent', name: 'Apparent',
  register(ctx) {
    let disposed = false;
    let working = false;
    let pending: Pending | null = null;
    let bridgeKey: { token: string; value: string } | undefined;
    let timer: (() => void) | undefined;
    const hasPending = atom(false);
    const save = () => { hasPending.set(Boolean(pending)); return ctx.storage.set('recording', pending); };
    const report = (message: string) => { if (!disposed) host.notify({ kind: 'error', message }); };
    ctx.onDispose(() => { disposed = true; timer?.(); });

    async function local(operation: Pending, endpoint: 'state' | 'ack') {
      if (bridgeKey?.token !== operation.token) {
        const route = (await host.profileRoutes()).find(candidate =>
          candidate.connectionId === operation.localRoute.connectionId &&
          candidate.profile === operation.localRoute.profile &&
          candidate.targetProfile === operation.localRoute.targetProfile && candidate.mode === 'local');
        if (!route) throw new Error('The local Apparent route is unavailable. The capture remains saved locally.');
        const result = await host.requestProfile(route, 'shell.exec', { command: keyCommand(operation.token) });
        const key = result?.stdout?.trim();
        if (result?.code !== 0 || !validToken(key) || key === operation.token) throw new Error('Apparent recording bridge is unavailable');
        bridgeKey = { token: operation.token, value: key };
      }
      const secret = bridgeKey.value;
      const id = await mailboxId(operation.token);
      const suffix = `${endpoint}/${await sign(secret, `${endpoint}:${id}`)}`;
      const response = await fetch(`http://127.0.0.1:${operation.port}/${id}/${suffix}`, {
        method: endpoint === 'ack' ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error('Apparent recording bridge is unavailable');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty Apparent response');
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 32768) { await reader.cancel(); throw new Error('Oversized Apparent response'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const packet = JSON.parse(new TextDecoder().decode(bytes));
      return endpoint === 'state' ? authenticatedState(secret, packet) : packet;
    }

    async function poll() {
      if (disposed || working || !pending || pending.sending) return;
      working = true;
      const operation = pending;
      try {
        if (Date.now() - operation.created > 60 * 60 * 1000 || Date.now() < operation.created) {
          pending = null; await save();
          throw new Error('Recording handoff expired. Your capture remains in Apparent.');
        }
        let state;
        try { state = await local(operation, 'state'); }
        catch (error) {
          if (operation.source) state = { phase: 'saved', source: operation.source };
          else if (Date.now() - operation.created < 30000) return;
          else { throw error; }
        }
        if (disposed || pending !== operation) return;
        if (state.phase === 'cancelled' || state.phase === 'error') {
          await local(operation, 'ack').catch(() => {});
          pending = null; await save();
          throw new Error(state.phase === 'cancelled' ? 'Recording cancelled. Nothing was sent.' : state.code === 'occupied' ? 'Apparent is already recording or processing. Finish that capture before trying again.' : 'Apparent could not finish the recording. Open Apparent to inspect it.');
        }
        if (state.phase !== 'saved' || !validSource(state.source)) return;
        if (operation.source && operation.source !== state.source) throw new Error('Recording return changed. Nothing was sent again.');
        operation.source = state.source;
        await save();
        if (!operation.destination.local && !validToken(state.source)) {
          timer?.(); timer = undefined;
          throw new Error('Recording saved locally. This remote conversation needs an existing Connect ID; no upload or read grant was enabled.');
        }

        const routes = await host.profileRoutes();
        const originalRoute = routes.find(route => route.connectionId === operation.destination.connectionId && route.profile === operation.destination.profile);
        if (!originalRoute || originalRoute.targetProfile !== operation.destination.targetProfile || originalRoute.mode !== operation.destination.mode) {
          timer?.(); timer = undefined;
          throw new Error('The original Hermes route changed. The saved recording was not sent.');
        }
        const owner = host.state.focusedSessionOwner?.get();
        if (host.state.focusedSessionId?.get() !== operation.destination.session ||
            host.state.focusedStoredSessionId?.get() !== operation.destination.storedSession ||
            owner?.connectionId !== operation.destination.connectionId || owner?.profile !== operation.destination.profile) return;
        if (disposed || pending !== operation) return;

        // The SDK returns only local dispatch, not backend receipt. Persist this one-shot
        // marker first so a reload after an ambiguous dispatch never submits a duplicate.
        operation.sending = true;
        await save();
        if (disposed || pending !== operation) return;
        const accepted = host.composer.submit(operation.destination.session, submission(operation.destination, operation.token, state.source));
        if (!accepted) {
          operation.sending = false;
          await save();
          timer?.(); timer = undefined;
          throw new Error('The original conversation composer is no longer visible. Focus it and click Apparent to retry the saved recording.');
        }
        pending = null;
        await save();
        await local(operation, 'ack').catch(() => {});
      } catch (error) {
        timer?.(); timer = undefined;
        report(error instanceof Error ? error.message : 'Recording delivery failed. Check the original conversation.');
      } finally { working = false; }
    }
    function watch() { timer?.(); timer = ctx.setInterval(() => void poll(), 2000); void poll(); }

    async function record() {
      if (disposed || working) return;
      if (pending) { if (!pending.sending) watch(); return; }
      working = true;
      let launchMayHaveStarted = false;
      try {
        const owner = host.state.focusedSessionOwner?.get();
        const session = host.state.focusedSessionId?.get();
        const storedSession = host.state.focusedStoredSessionId?.get();
        if (!owner || !session || !storedSession) throw new Error('Open a saved Hermes conversation before recording. Unsaved chats cannot be pinned safely by the public SDK.');
        if (typeof host.composer?.submit !== 'function') throw new Error('This Hermes Desktop SDK does not expose the supported composer submit API.');
        const routes = await host.profileRoutes();
        const destinations = routes.filter(route => route.connectionId === owner.connectionId && route.profile === owner.profile);
        if (destinations.length !== 1) throw new Error('The conversation’s gateway route is ambiguous or unavailable.');
        const destinationRoute = destinations[0];
        if (!destinationRoute.targetProfile || !destinationRoute.mode) throw new Error('Hermes does not expose a complete route for this conversation.');
        const localRoutes = routes.filter(route => route.mode === 'local' && route.profile === 'default');
        if (localRoutes.length !== 1 || !localRoutes[0].targetProfile) throw new Error('Hermes does not expose one unambiguous local recording route.');
        const originalOwner = host.state.focusedSessionOwner?.get();
        if (disposed || host.state.focusedSessionId?.get() !== session || host.state.focusedStoredSessionId?.get() !== storedSession ||
            originalOwner?.connectionId !== owner.connectionId || originalOwner?.profile !== owner.profile) throw new Error('The destination changed while preparing recording. Nothing was started.');
        const bytes = crypto.getRandomValues(new Uint32Array(1));
        bridgeKey = undefined;
        pending = {
          version: 3,
          token: crypto.randomUUID().replaceAll('-', ''),
          port: 32768 + bytes[0] % (60999 - 32768 + 1),
          destination: { session, storedSession, connectionId: owner.connectionId, profile: owner.profile, targetProfile: destinationRoute.targetProfile, mode: destinationRoute.mode, local: destinationRoute.mode === 'local' },
          localRoute: { connectionId: localRoutes[0].connectionId, profile: localRoutes[0].profile, targetProfile: localRoutes[0].targetProfile },
          created: Date.now(),
        };
        await save();
        if (disposed) return;
        const localRoute = routes.find(route => route.connectionId === pending!.localRoute.connectionId && route.profile === pending!.localRoute.profile && route.targetProfile === pending!.localRoute.targetProfile && route.mode === 'local');
        if (!localRoute) throw new Error('The local recording route changed. Nothing was started.');
        launchMayHaveStarted = true;
        const result = await host.requestProfile(localRoute, 'shell.exec', { command: recordCommand(pending.token, pending.port) });
        if (result?.code !== 0) throw new Error('Apparent could not start the recording. Check the local app and its permissions.');
        if (!disposed) watch();
      } catch (error) {
        if (launchMayHaveStarted && pending) { if (!disposed) watch(); }
        else { pending = null; await save(); }
        report(error instanceof Error ? error.message : 'Unable to start Apparent');
      } finally { working = false; }
    }

    Promise.resolve(ctx.storage.get('recording')).then(async value => {
      if (disposed || pending || !value) return;
      if (value.version !== 3) { await ctx.storage.set('recording', null); report('This older recording handoff cannot resume safely. Copy its recording from Apparent into Hermes.'); return; }
      if (!validToken(value.token) || !Number.isInteger(value.port) || value.port < 32768 || value.port > 60999 || !Number.isFinite(value.created)) return;
      if (!value.destination || !['session', 'storedSession', 'connectionId', 'profile', 'targetProfile', 'mode'].every(key => typeof value.destination[key] === 'string' && value.destination[key]) || typeof value.destination.local !== 'boolean') return;
      if (!value.localRoute || !['connectionId', 'profile', 'targetProfile'].every(key => typeof value.localRoute[key] === 'string' && value.localRoute[key])) return;
      if (value.source !== undefined && !validSource(value.source)) return;
      pending = value;
      hasPending.set(true);
      if (pending.sending) report('Hermes dispatched this recording before its last reply. Check the original conversation; the plugin will not send it again automatically.');
      else watch();
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
        await local(operation, 'ack').catch(() => {});
      },
    } });
  },
};
