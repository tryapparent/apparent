export const shared = {
  owner: { connectionId: 'ssh-A', profile: 'work' }, session: 'runtime-A', storedSession: 'stored-A',
  routes: [
    { connectionId: 'ssh-A', profile: 'work', targetProfile: 'work', mode: 'remote' },
    { connectionId: 'local-A', profile: 'default', targetProfile: 'default', mode: 'local' },
  ],
  requests: [] as unknown[], submissions: [] as Array<{ session: string; text: string }>, errors: [] as string[],
  key: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', source: 'cccccccccccccccccccccccccccccccc',
  draft: 'typed draft must remain unchanged', acceptSubmit: true,
};
export const host = {
  state: {
    focusedSessionOwner: { get: () => shared.owner },
    focusedSessionId: { get: () => shared.session },
    focusedStoredSessionId: { get: () => shared.storedSession },
  },
  profileRoutes: async () => shared.routes,
  requestProfile: async (route: any, method: string, params: any) => {
    if (method !== 'shell.exec') throw new Error(`Unsupported stock shell contract method: ${method}`);
    if (!route?.mode || !route?.connectionId || !route?.profile) throw new Error('Expected a profile route descriptor');
    if (!params || typeof params.command !== 'string' || 'session_id' in params || Object.keys(params).some(key => !['command', 'profile'].includes(key))) throw new Error('Unexpected shell.exec parameters');
    shared.requests.push({ route: { ...route }, method, params: { ...params } });
    if (params.command.includes('/apparent-hermes/')) return { code: 0, stdout: shared.key, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  },
  composer: {
    getDraft: async (session: string) => session === shared.session ? shared.draft : null,
    insertText: async () => { throw new Error('Plugin must not mutate composer drafts'); },
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
