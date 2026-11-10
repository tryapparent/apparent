// Connect-owned consent and destructive-confirmation policy worker.
// This file is intentionally dependency-free so the native adapter can run its
// compiled CommonJS artifact in the already staged Electron runtime.
export type PolicyAction = 'connect' | 'allow' | 'cancel' | 'request-disable' |
  'request-disconnect' | 'disable' | 'disconnect';
export type Confirmation = 'disable' | 'disconnect' | null;
export type PolicyState = { consent: boolean; confirmation: Confirmation };
export type PolicyContext = {
  action: PolicyAction;
  snapshotAvailable: boolean;
  busy: boolean;
  retryDisable: boolean | null;
  closed: boolean;
};
export type PolicyEffect = 'allow' | 'disable' | 'disconnect' | null;
export type Button = { command: PolicyAction; title: string; enabled: boolean };
export type Overlay = {
  mode: 'consent' | 'confirmation' | null;
  title: string;
  status: string;
  detail: string;
  note: string;
  buttons: Button[];
  presentation: {
    tone: 'neutral' | 'warning'; headline: string; detail: string; note: string;
    artwork: boolean; compact: boolean; accountMenu: boolean; buttons: Button[];
    menuActions: PolicyAction[]; sharedLinksUrl: null;
  } | null;
};
export type PolicyResult = { state: PolicyState; effect: PolicyEffect; overlay: Overlay };

const neutral: Overlay = {
  mode: null, title: '', status: '', detail: '', note: '', buttons: [], presentation: null,
};
const consentView = (): Overlay => {
  const buttons: Button[] = [
    { command: 'allow', title: 'Allow and continue', enabled: true },
    { command: 'cancel', title: 'Not now', enabled: true },
  ];
  const presentationButtons: Button[] = [
    { command: 'allow', title: 'Allow & continue', enabled: true },
    { command: 'cancel', title: 'Not now', enabled: true },
  ];
  return {
    mode: 'consent', title: 'Apparent Connect', status: 'Allow uploads?',
    detail: 'New captures will upload privately to your account, including screen images, recordings, voice, transcripts, context and other supported assets. Website sign-in alone does not connect this computer. Allow uploads to continue?',
    note: 'Existing captures are not uploaded. No public links are created. Disabling cancels unfinished uploads; disconnecting also signs out this computer. Already uploaded data is not deleted.',
    buttons,
    presentation: {
      tone: 'neutral', headline: 'Allow new capture uploads?',
      detail: 'New captures upload privately, including recordings, images, audio, transcripts, context and other capture assets.',
      note: 'Older captures stay local. Sharing is a separate action.', artwork: true,
      compact: false, accountMenu: false, buttons: presentationButtons, menuActions: [], sharedLinksUrl: null,
    },
  };
};
const confirmationView = (kind: Exclude<Confirmation, null>): Overlay => {
  const disconnect = kind === 'disconnect';
  const buttons: Button[] = [
    { command: kind, title: disconnect ? 'Disconnect' : 'Turn off uploads', enabled: true },
    { command: 'cancel', title: disconnect ? 'Keep connected' : 'Keep uploads on', enabled: true },
  ];
  const detail = disconnect
    ? 'Unfinished uploads stop. Already uploaded captures and shared links are not deleted.'
    : 'Unfinished uploads stop. You stay signed in, and already uploaded captures remain.';
  const headline = disconnect ? 'Disconnect this computer?' : 'Turn uploads off?';
  return {
    mode: 'confirmation', title: 'Apparent Connect', status: headline, detail, note: '', buttons,
    presentation: {
      tone: 'warning', headline, detail, note: '', artwork: false, compact: false,
      accountMenu: false, buttons, menuActions: [], sharedLinksUrl: null,
    },
  };
};

/** Pure transition for the one migrated subjourney. Network and persistence stay native. */
export function transition(state: PolicyState, context: PolicyContext): PolicyResult {
  const next: PolicyState = { ...state };
  let effect: PolicyEffect = null;
  if (context.closed || context.busy) return { state: next, effect, overlay: neutral };
  switch (context.action) {
    case 'connect':
      next.consent = false;
      if (context.snapshotAvailable && context.retryDisable === null) {
        next.consent = true;
        next.confirmation = null;
      }
      break;
    case 'allow':
      if (state.consent) {
        next.consent = false;
        if (context.snapshotAvailable && context.retryDisable === null) effect = 'allow';
      }
      break;
    case 'request-disable':
    case 'request-disconnect':
      next.consent = false;
      next.confirmation = context.action === 'request-disconnect' ? 'disconnect' : 'disable';
      break;
    case 'disable':
      if (state.confirmation === 'disable' || context.retryDisable === false) {
        next.confirmation = null;
        effect = 'disable';
      }
      break;
    case 'disconnect':
      if (state.confirmation === 'disconnect' || context.retryDisable === true) {
        next.confirmation = null;
        effect = 'disconnect';
      }
      break;
    case 'cancel':
      if (state.confirmation !== null) next.confirmation = null;
      else if (state.consent) next.consent = false;
      break;
  }
  const overlay = next.confirmation ? confirmationView(next.confirmation)
    : next.consent ? consentView() : neutral;
  return { state: next, effect, overlay };
}

// The native adapter sends one bounded JSON request per child. No paths,
// credentials, raw errors or browser URLs are accepted by this worker.
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    input += chunk;
    if (Buffer.byteLength(input) > 4096) process.exitCode = 2;
  });
  process.stdin.on('end', () => {
    try {
      const request = JSON.parse(input) as { state: PolicyState; context: PolicyContext };
      const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
      const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(',') === [...keys].sort().join(',');
      if (!object(request) || !exact(request, ['state', 'context']) ||
          !object(request.state) || !exact(request.state, ['consent', 'confirmation']) ||
          !object(request.context) || !exact(request.context, ['action', 'snapshotAvailable', 'busy', 'retryDisable', 'closed']) ||
          !['connect', 'allow', 'cancel', 'request-disable', 'request-disconnect', 'disable', 'disconnect'].includes(request.context.action as string) ||
          typeof request.context.snapshotAvailable !== 'boolean' || typeof request.context.busy !== 'boolean' ||
          typeof request.context.closed !== 'boolean' ||
          !(request.context.retryDisable === null || typeof request.context.retryDisable === 'boolean') ||
          typeof request.state.consent !== 'boolean' ||
          !(request.state.confirmation === null || request.state.confirmation === 'disable' || request.state.confirmation === 'disconnect')) {
        process.exitCode = 2;
        return;
      }
      process.stdout.write(JSON.stringify(transition(request.state, request.context)) + '\n');
    } catch {
      process.exitCode = 2;
    }
  });
}
