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

    function destinationMatches(destination: Pending['destination'], routes: any[]) {
      const owner = host.state.focusedSessionOwner?.get();
      return !disposed && host.state.focusedSessionId?.get() === destination.session &&
        host.state.focusedStoredSessionId?.get() === destination.storedSession &&
        owner?.connectionId === destination.connectionId && owner?.profile === destination.profile &&
        routes.some(route => route.connectionId === destination.connectionId && route.profile === destination.profile &&
          route.targetProfile === destination.targetProfile && route.mode === destination.mode);
    }

    async function destinationCurrent(destination: Pending['destination']) {
      return destinationMatches(destination, await host.profileRoutes());
    }

    async function newDraftCurrent(owner: { connectionId: string; profile: string }, route: any) {
      const routes = await host.profileRoutes();
      const focused = host.state.focusedSessionOwner?.get();
      return !disposed && !host.state.focusedSessionId?.get() && !host.state.focusedStoredSessionId?.get() &&
        focused?.connectionId === owner.connectionId && focused?.profile === owner.profile &&
        routes.some(candidate => candidate.connectionId === route.connectionId && candidate.profile === route.profile &&
          candidate.targetProfile === route.targetProfile && candidate.mode === route.mode);
    }

    async function local(operation: Pending, endpoint: 'state' | 'ack') {
      if (bridgeKey?.token !== operation.token) {
        const route = (await host.profileRoutes()).find(candidate =>
          candidate.connectionId === operation.localRoute.connectionId &&
          candidate.profile === operation.localRoute.profile &&
          candidate.targetProfile === operation.localRoute.targetProfile && candidate.mode === 'local');
        if (!route) throw new Error('The local Apparent route is unavailable. The capture remains saved locally.');
        const result = await host.requestProfile(route, 'shell.exec', { command: keyCommand(operation.token) });
        const key = result?.stdout?.trim();
        if (result?.code !== 0 || typeof key !== 'string' || !validToken(key) || key === operation.token) throw new Error('Apparent recording bridge is unavailable');
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
        if (disposed || pending !== operation || !(await destinationCurrent(operation.destination))) return;
        if (!operation.destination.local && !validToken(state.source)) {
          timer?.(); timer = undefined;
          throw new Error('Recording saved locally. This remote conversation needs an existing Connect ID; no upload or read grant was enabled.');
        }
        if (typeof host.composer?.getDraft !== 'function' || typeof host.composer?.insertText !== 'function' || typeof host.composer?.submit !== 'function') {
          timer?.(); timer = undefined;
          throw new Error('This Hermes Desktop SDK does not expose the supported composer draft APIs. The recording remains saved in Apparent.');
        }
        // The SDK returns only local dispatch, not backend receipt. Persist this one-shot
        // marker first so a reload after an ambiguous dispatch never submits a duplicate.
        operation.sending = true;
        operation.manual = false;
        await save();
        if (disposed || pending !== operation) return;
        if (!(await destinationCurrent(operation.destination))) {
          operation.sending = false;
          await save();
          return;
        }
        if (disposed || pending !== operation) return;
        const draft = await host.composer.getDraft(operation.destination.session);
        if (disposed || pending !== operation || !(await destinationCurrent(operation.destination))) return;
        const text = submission(operation.destination, operation.token, state.source);
        const accepted = draft ? await host.composer.insertText(operation.destination.session, text, { mode: 'block' }) :
          host.composer.submit(operation.destination.session, text);
        const stillVisibleAfterDispatch = await destinationCurrent(operation.destination);
        if (disposed || pending !== operation) return;
        if (!accepted) {
          operation.sending = false;
          operation.manual = true;
          await save();
          timer?.(); timer = undefined;
          throw new Error('Hermes did not dispatch the recording handoff. Your source remains saved in Apparent for manual recovery.');
        }
        pending = null;
        await save();
        // insertText's acknowledgement confirms only that the visible composer
        // applied the block. Neither it nor submit's boolean proves backend receipt.
        // This separate ACK closes Apparent's loopback request; it is not Hermes admission.
        await local(operation, 'ack').catch(() => {});
        if (!stillVisibleAfterDispatch) report('The handoff was placed in the pinned conversation composer, but focus changed afterward. Check that conversation before sending.');
      } catch (error) {
        timer?.(); timer = undefined;
        report(error instanceof Error ? error.message : 'Recording delivery failed. Check the original conversation.');
      } finally { working = false; }
    }
    function watch() { timer?.(); timer = ctx.setInterval(() => void poll(), 2000); void poll(); }

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
          } catch (error) { report(error instanceof Error ? error.message : 'The saved handoff could not be prepared for retry.'); }
          finally { working = false; }
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
        if (!owner || Boolean(initialSession) !== Boolean(initialStored)) throw new Error('Hermes does not expose a complete owner and session address for this composer. Nothing was started.');
        if (typeof host.composer?.getDraft !== 'function' || typeof host.composer?.insertText !== 'function' || typeof host.composer?.submit !== 'function') {
          throw new Error('This Hermes Desktop SDK does not expose the supported composer draft APIs.');
        }
        if (isNewDraft && (typeof host.requestProfile !== 'function' || typeof host.openSession !== 'function')) {
          throw new Error('This Hermes Desktop SDK cannot create and open a pinned conversation from a fresh draft. Nothing was started.');
        }
        const routes = await host.profileRoutes();
        const ownerAfterRoutes = host.state.focusedSessionOwner?.get();
        if (disposed || host.state.focusedSessionId?.get() !== initialSession || host.state.focusedStoredSessionId?.get() !== initialStored ||
            ownerAfterRoutes?.connectionId !== owner.connectionId || ownerAfterRoutes?.profile !== owner.profile) {
          throw new Error('The destination changed while preparing recording. Nothing was started.');
        }
        const destinations = routes.filter(route => route.connectionId === owner.connectionId && route.profile === owner.profile);
        if (destinations.length !== 1) throw new Error('The conversation’s gateway route is ambiguous or unavailable.');
        const destinationRoute = destinations[0];
        if (!destinationRoute.targetProfile || !destinationRoute.mode) throw new Error('Hermes does not expose a complete route for this conversation.');
        const localRoutes = routes.filter(route => route.mode === 'local' && route.profile === 'default');
        if (localRoutes.length !== 1 || !localRoutes[0].targetProfile) throw new Error('Hermes does not expose one unambiguous local recording route.');

        let session = initialSession;
        let storedSession = initialStored;
        if (isNewDraft) {
          const originalDraft = await host.composer.getDraft('new');
          if (!(await newDraftCurrent(owner, destinationRoute))) throw new Error('The fresh composer changed while reading its draft. Nothing was started.');
          const idempotencyKey = crypto.randomUUID().replaceAll('-', '');
          const created = await host.requestProfile<{ session_id: string; stored_session_id: string }>(destinationRoute, 'session.create', { idempotency_key: idempotencyKey });
          if (!(await newDraftCurrent(owner, destinationRoute))) throw new Error('The fresh composer changed while binding a conversation. No recording was started.');
          if (!created || typeof created.session_id !== 'string' || !created.session_id ||
              typeof created.stored_session_id !== 'string' || !created.stored_session_id) {
            throw new Error('Hermes did not return both runtime and stored IDs for the new conversation. Nothing was started.');
          }
          await host.openSession(created.stored_session_id, { route: destinationRoute, awaitHydration: true, expectHistory: false });
          session = host.state.focusedSessionId?.get();
          storedSession = host.state.focusedStoredSessionId?.get();
          if (!session || storedSession !== created.stored_session_id) throw new Error('Hermes did not bind the created conversation to the visible composer. Nothing was started.');
          const createdDestination = { session, storedSession, connectionId: owner.connectionId, profile: owner.profile,
            targetProfile: destinationRoute.targetProfile, mode: destinationRoute.mode, local: destinationRoute.mode === 'local' };
          if (!(await destinationCurrent(createdDestination))) throw new Error('The created conversation is no longer the visible destination. Nothing was started.');

          const openedDraft = await host.composer.getDraft(session);
          if (!(await destinationCurrent(createdDestination))) throw new Error('The destination changed while checking its typed draft. Nothing was started.');
          if (originalDraft && openedDraft !== originalDraft) {
            if (openedDraft) throw new Error('The new conversation already has different typed text; nothing was replaced and recording did not start.');
            const retained = await host.composer.insertText(session, originalDraft, { mode: 'block' });
            if (!(await destinationCurrent(createdDestination))) throw new Error('The conversation changed while preserving its typed draft. No recording was started.');
            if (!retained) throw new Error('Hermes could not preserve the typed draft in the created conversation. Nothing was started.');
          }
        }
        if (!session || !storedSession) throw new Error('A saved conversation could not be pinned safely. Nothing was started.');
        const destination = { session, storedSession, connectionId: owner.connectionId, profile: owner.profile,
          targetProfile: destinationRoute.targetProfile, mode: destinationRoute.mode, local: destinationRoute.mode === 'local' };
        if (!(await destinationCurrent(destination))) throw new Error('The destination changed before recording. Nothing was started.');
        const bytes = crypto.getRandomValues(new Uint32Array(1));
        bridgeKey = undefined;
        pending = {
          version: 3,
          token: crypto.randomUUID().replaceAll('-', ''),
          port: 32768 + bytes[0] % (60999 - 32768 + 1),
          destination,
          localRoute: { connectionId: localRoutes[0].connectionId, profile: localRoutes[0].profile, targetProfile: localRoutes[0].targetProfile },
          created: Date.now(),
        };
        await save();
        if (disposed || pending === null) return;
        const currentRoutes = await host.profileRoutes();
        if (disposed || pending === null) return;
        if (!destinationMatches(destination, currentRoutes)) { pending = null; await save(); return; }
        const localRoute = currentRoutes.find(route => route.connectionId === pending!.localRoute.connectionId && route.profile === pending!.localRoute.profile && route.targetProfile === pending!.localRoute.targetProfile && route.mode === 'local');
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
      if (typeof value.token !== 'string' || !validToken(value.token) || !Number.isInteger(value.port) || value.port < 32768 || value.port > 60999 || !Number.isFinite(value.created)) return;
      if (!value.destination || !['session', 'storedSession', 'connectionId', 'profile', 'targetProfile', 'mode'].every(key => typeof value.destination[key] === 'string' && value.destination[key]) || typeof value.destination.local !== 'boolean') return;
      if (!value.localRoute || !['connectionId', 'profile', 'targetProfile'].every(key => typeof value.localRoute[key] === 'string' && value.localRoute[key])) return;
      if (value.manual !== undefined && typeof value.manual !== 'boolean') return;
      if (value.source !== undefined && !validSource(value.source)) return;
      pending = value;
      hasPending.set(true);
      if (pending.sending) report('Hermes may have dispatched this recording before its last reply. Check the original conversation; the plugin will not send it again automatically.');
      else if (pending.manual) report('The recording was not dispatched. Its source remains saved in Apparent for manual recovery.');
      else watch();
    }).catch(() => {});

    function RecordButton() {
      const waiting = useValue(hasPending);
      const label = pending?.manual ? 'Retry saved Apparent handoff' : waiting ? 'Check Apparent recording handoff' : 'Record with Apparent';
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
