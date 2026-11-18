type Request = {
  route: { connectionId: string; profile: string; targetProfile: string; mode: string };
  method: string;
  params: { command?: string; session_id?: string; request_id?: string; source?: string; hidden?: boolean };
};

export const shared = {
  owner: { connectionId: 'ssh-A', profile: 'work' }, session: 'runtime-A' as string | null, storedSession: 'stored-A' as string | null,
  routes: [
    { connectionId: 'ssh-A', profile: 'work', targetProfile: 'work', mode: 'remote' },
    { connectionId: 'local-A', profile: 'default', targetProfile: 'default', mode: 'local' },
  ],
  requests: [] as Request[], submissions: [] as Array<{ session: string; text: string }>, insertions: [] as Array<{ session: string; text: string; mode?: string }>, draftReads: [] as string[], opens: [] as unknown[], errors: [] as string[],
  key: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', source: 'cccccccccccccccccccccccccccccccc', bundlePath: '/private/owned.apparent',
  draft: 'typed draft must remain unchanged', newDraft: 'typed draft must remain unchanged', acceptSubmit: true, acceptInsert: true,
  draftReadGate: undefined as Promise<void> | undefined,
  draftReadStart: undefined as (() => void) | undefined,
  sessionCreate: { session_id: 'created-runtime', stored_session_id: 'created-stored' },
  sessionCreateGate: undefined as Promise<void> | undefined,
  sessionCreateStart: undefined as (() => void) | undefined,
  legacyRuntimeDescribe: false,
  runtimeDescribeError: undefined as unknown,
  setupStatus: { schema: 1, status: 'ready' } as unknown,
  setupRpcError: undefined as unknown,
  setupGate: undefined as Promise<void> | undefined,
  shellSetupResult: { code: 0, stdout: '{"schema":1,"status":"ready"}', stderr: '' },
  notices: [] as Array<{ kind?: string; message: string; action?: { label: string; onClick: () => void } }>,
};
export const host = {
  state: {
    focusedSessionOwner: { get: () => shared.owner },
    focusedSessionId: { get: () => shared.session },
    focusedStoredSessionId: { get: () => shared.storedSession },
  },
  profileRoutes: async () => shared.routes,
  requestProfile: async (route: any, method: string, params: any) => {
    if (!['shell.exec', 'session.create', 'runtime.describe', 'plugin.apparent.setup_status'].includes(method)) throw new Error(`Unsupported stock profile contract method: ${method}`);
    if (!route?.mode || !route?.connectionId || !route?.profile) throw new Error('Expected a profile route descriptor');
    if (method === 'shell.exec' && (!params || typeof params.command !== 'string' || Object.keys(params).some(key => !['command', 'profile', 'session_id'].includes(key)) || ('session_id' in params && (typeof params.session_id !== 'string' || !params.session_id)))) throw new Error('Unexpected shell.exec parameters');
    if (method === 'session.create' && (!params || typeof params.request_id !== 'string' || params.source !== 'gui' || Object.keys(params).some(key => !['request_id', 'source', 'hidden'].includes(key)))) throw new Error('Unexpected session.create parameters');
    shared.requests.push({ route: { ...route }, method, params: { ...params } });
    if (method === 'plugin.apparent.setup_status') {
      if (route.mode !== 'local' || Object.keys(params).length) throw new Error('Unexpected setup status route or parameters');
      if (shared.setupRpcError) throw shared.setupRpcError;
      await shared.setupGate;
      return shared.setupStatus;
    }
    if (method === 'runtime.describe') {
      if (shared.runtimeDescribeError) throw shared.runtimeDescribeError;
      if (shared.legacyRuntimeDescribe) throw { code: -32601, data: { reason: 'unknown_method' } };
      return { capabilities: ['local-cli-create-v1'], session_create: { sources: ['gui'], parameters: ['request_id', 'source'] } };
    }
    if (method === 'session.create') {
      shared.sessionCreateStart?.();
      if (shared.sessionCreateGate) await shared.sessionCreateGate;
      return route.mode === 'local'
        ? { session_id: 'helper-runtime', stored_session_id: 'helper-stored' }
        : { ...shared.sessionCreate };
    }
    if (params.command === 'apparent hermes status') return shared.shellSetupResult;
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
  notify: (notice: (typeof shared.notices)[number]) => {
    shared.notices.push(notice);
    if (notice.kind === 'error') shared.errors.push(notice.message);
  },
};
export const COMPOSER_AREAS = { actions: 'composer.actions' };
export const PALETTE_AREA = 'palette';
export const Button = () => {};
export const Codicon = () => {};
export const jsx = (type: unknown, props: unknown) => ({ type, props });
export const atom = (initial: unknown) => { let value = initial; return { get: () => value, set: (next: unknown) => { value = next; } }; };
export const useValue = (value: { get(): unknown }) => value.get();
