export type ConnectAction = 'connect' | 'allow' | 'cancel' | 'check' | 'disable' | 'disconnect' | 'open-browser' | 'request-disable' | 'request-disconnect' | 'open-shared-links';
export type ConnectView = {
  phase?: 'disconnected' | 'consent' | 'starting' | 'approval' | 'connected' | 'cancelling' | 'waitlisted' | 'failed';
  localReady?: boolean;
  title: string; status: string; detail: string; server: string | null;
  verificationUri: string | null; userCode: string | null;
  buttons: ConnectButton[]; note: string;
  presentation?: { tone: 'neutral' | 'success' | 'progress' | 'warning' | 'failure';
    headline: string; detail: string; note: string; artwork: boolean; compact: boolean;
    accountMenu: boolean; accountInitial?: string; buttons: ConnectButton[]; menuActions: ConnectAction[]; sharedLinksUrl: string | null };
};
export type ConnectButton = { command: ConnectAction; title: string; enabled: boolean };
export type ConnectSettings =
  | { status: 'connected'; view: ConnectView }
  | { status: 'disabled' | 'disconnected' | 'cancelled' }
  | { status: 'error' };
