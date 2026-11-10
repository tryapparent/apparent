import {Button} from '@apparent/ui/button';
import type {AccountState} from '../../electron/onboarding/account';
import './account.css';

const messages: Record<string, string> = {
  offline: 'Couldn’t reach sign-in. Check your connection and try again, or set up locally.',
  rejected: 'Sign-in wasn’t approved. You can try again or set up locally.',
  expired: 'That sign-in code expired. Start again for a new code.',
  'auth-required': 'Please sign in again to connect this app.',
  'local-state': 'Apparent couldn’t read or save account access. You can still set up locally.',
  'invalid-server': 'The account server in your configuration is invalid.',
  unavailable: 'Sign-in couldn’t finish. Try again or set up locally.',
  browser: 'The browser could not open. Try opening it again.',
};
export function OnboardingAccount({state, action}: {state: AccountState | null; action: (value: string) => Promise<void>}) {
  if (!state) return <div className="native-account"><p>Account sign-in is unavailable. You can still set up locally.</p><Button onClick={() => void action('continue')}>Set up locally</Button></div>;
  const busy = state.status === 'starting' || state.status === 'approval';
  return <div className="native-account" data-pending={busy} aria-live="polite">
    {state.status === 'signed-in' ? <p>✓ Signed in.</p> : <>
      {state.status === 'approval' ? <>
        <p>Approve access in your browser. Match this code:</p>
        <code>{state.userCode}</code>
        <Button onClick={() => void action('open-sign-in')}>Continue in browser</Button>
        <p>Beta full? Join the waitlist in your browser and set up locally. Signing in alone doesn’t grant cloud access.</p>
      </> : <Button disabled={state.status === 'loading' || busy} onClick={() => void action('sign-in')}>
        {state.status === 'loading' ? 'Checking account…' : busy ? 'Starting sign-in…' : 'Sign in with Google'}
      </Button>}
      <div className="native-account-actions">
        {busy && <Button variant="ghost" onClick={() => void action('cancel-sign-in')}>Cancel sign-in</Button>}
        <Button variant="ghost" onClick={() => void action('continue')}>Set up locally</Button>
      </div>
    </>}
    {state.error && messages[state.error] && <p role="alert">{messages[state.error]}</p>}
    <p>Recording stays local. Uploads need separate permission in Settings.</p>
  </div>;
}
