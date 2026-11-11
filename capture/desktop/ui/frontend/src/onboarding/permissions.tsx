import {Button} from '@apparent/ui/button';

export type PermissionRow = {permission:string;status:string;required:boolean;reopening:boolean;relaunch:boolean};
const names: Record<string,string> = {'screen-recording':'Screen & System Audio Recording',microphone:'Microphone',accessibility:'Accessibility','speech-recognition':'Speech Recognition',camera:'Camera'};

export function Permissions({platform, rows, action}: {
  platform:'linux'|'macos';rows:PermissionRow[];action:(value:string)=>Promise<void>;
}) {
  return <div className="native-permissions">{rows.map(row => {
    const linuxInput = platform === 'linux' && row.permission === 'accessibility';
    const linuxScreen = platform === 'linux' && row.permission === 'screen-recording';
    const granted = row.status === 'granted' && !row.relaunch;
    return <div key={row.permission}>
      <div className="native-permission-description">
        <strong>{linuxInput ? 'Input devices' : linuxScreen ? 'Screen recording' : names[row.permission]}</strong>
        {!row.required && <small>Optional</small>}
        {linuxInput && !granted && <small>To draw and add notes over other apps, run this command in a terminal, then log out and back in. This grants your account access to keyboard and pointer input across all apps.</small>}
        {linuxInput && !granted && <code>sudo usermod -aG input "$USER"</code>}
      </div>
      {row.reopening ? <span>Reopening apparent…</span> : granted ?
        <span className={linuxScreen ? undefined : 'native-granted'}>{linuxScreen ? 'Asked when recording starts' : '✓ Enabled'}</span> :
        <Button variant="outline" onClick={() => void action(`grant:${row.permission}`)}>{row.relaunch ? 'Reopen apparent' : linuxInput ? 'Copy command' : 'Open Settings'}</Button>}
    </div>;
  })}</div>;
}
