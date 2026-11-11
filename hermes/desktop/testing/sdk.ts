export const shared = {
  owner: { connectionId: 'ssh-A', profile: 'work' }, session: 'runtime-A', storedSession: 'stored-A',
  routes: [
    { connectionId: 'ssh-A', profile: 'work', targetProfile: 'work', mode: 'remote' },
    { connectionId: 'local-A', profile: 'default', targetProfile: 'default', mode: 'local' },
  ],
  requests: [] as unknown[], submissions: [] as Array<{ session: string; text: string }>, insertions: [] as Array<{ session: string; text: string; mode?: string }>, draftReads: [] as string[], opens: [] as unknown[], errors: [] as string[],
  key: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', source: 'cccccccccccccccccccccccccccccccc',
  draft: 'typed draft must remain unchanged', newDraft: 'typed draft must remain unchanged', acceptSubmit: true, acceptInsert: true,
  draftReadGate: undefined as Promise<void> | undefined,
  draftReadStart: undefined as (() => void) | undefined,
  sessionCreate: { session_id: 'created-runtime', stored_session_id: 'created-stored' },
};
export const host = {
  state: {
    focusedSessionOwner: { get: () => shared.owner },
    focusedSessionId: { get: () => shared.session },
    focusedStoredSessionId: { get: () => shared.storedSession },
  },
  profileRoutes: async () => shared.routes,
  requestProfile: async (route: any, method: string, params: any) => {
    if (!['shell.exec', 'session.create'].includes(method)) throw new Error(`Unsupported stock profile contract method: ${method}`);
    if (!route?.mode || !route?.connectionId || !route?.profile) throw new Error('Expected a profile route descriptor');
    if (method === 'shell.exec' && (!params || typeof params.command !== 'string' || 'session_id' in params || Object.keys(params).some(key => !['command', 'profile'].includes(key)))) throw new Error('Unexpected shell.exec parameters');
    if (method === 'session.create' && (!params || typeof params.idempotency_key !== 'string' || Object.keys(params).some(key => !['idempotency_key'].includes(key)))) throw new Error('Unexpected session.create parameters');
    shared.requests.push({ route: { ...route }, method, params: { ...params } });
    if (method === 'session.create') return { ...shared.sessionCreate };
    if (params.command.includes('/apparent-hermes/')) return { code: 0, stdout: shared.key, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  },
  openSession: async (storedSession: string, options: any) => {
    shared.opens.push({ storedSession, options: structuredClone(options) });
    shared.owner = { connectionId: options.route.connectionId, profile: options.route.profile };
    shared.session = 'resumed-runtime';
    shared.storedSession = storedSession;
  },
  composer: {
    getDraft: async (session: string) => {
      shared.draftReads.push(session);
      if (shared.draftReadGate) { shared.draftReadStart?.(); await shared.draftReadGate; }
      if (session === 'new') return shared.newDraft;
      return session === shared.session || session === shared.storedSession ? shared.draft : null;
    },
    insertText: async (session: string, text: string, options?: { mode?: string }) => {
      if (session !== shared.session || !shared.acceptInsert) return false;
      shared.insertions.push({ session, text, mode: options?.mode });
      shared.draft = shared.draft ? `${shared.draft}\n\n${text}` : text;
      return true;
    },
    setDraft: async () => { throw new Error('Plugin must not replace composer drafts'); },
    submit: (session: string, text: string) => {
      if (session !== shared.session || !shared.acceptSubmit) return false;
      shared.submissions.push({ session, text });
      return true;
    },
  },
  notify: (notice: { message: string }) => { shared.errors.push(notice.message); },
};
export const COMPOSER_AREAS = { actions: 'composer.actions' };
export const PALETTE_AREA = 'palette';
export const Button = () => {};
export const Codicon = () => {};
export const jsx = (type: unknown, props: unknown) => ({ type, props });
export const atom = (initial: unknown) => { let value = initial; return { get: () => value, set: (next: unknown) => { value = next; } }; };
export const useValue = (value: { get(): unknown }) => value.get();
