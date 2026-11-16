// Desktop owns the Agents preference workflow. Native only reads/writes the
// persisted experiment through the shared config transaction.
import type {T3Connection} from '../../electron/settings/t3';
export const skillCommand = 'bunx skills add https://github.com/tryapparent/apparent/tree/main/capture/agent/skills/apparent';
export type T3ConnectionResult = {facts:PreferenceFacts;reason?:never}|{reason:'cancelled'|'unavailable'|'unconfirmed';facts?:never};
export type PreferenceFacts = { saved: boolean | null; sharingSaved?:boolean|null;t3Saved?:boolean|null;t3Configured?:boolean;t3Origin?:string;t3ExpiresAt?:number;autoPasteSaved?:boolean|null;autoPasteSupported?:boolean;error?: never } | { error: 'config_read_failed' | 'config_write_failed'; saved?: never;sharingSaved?:never;t3Saved?:never;t3Configured?:never;t3Origin?:never;t3ExpiresAt?:never;autoPasteSaved?:never;autoPasteSupported?:never };
export function t3PickerEnabled(facts:PreferenceFacts):boolean|undefined{return facts.error?undefined:facts.t3Saved??false;}
export function preferenceEnabled(facts: PreferenceFacts): boolean | undefined {
  return facts.error ? undefined : facts.saved ?? true;
}
export function preferenceFacts(value: unknown): PreferenceFacts {
  if (!value || typeof value !== 'object') throw Error('Invalid Agents preference');
  const facts = value as Record<string, unknown>;
  if (facts.error === 'config_read_failed' || facts.error === 'config_write_failed') return {error: facts.error};
  if (facts.saved === null || typeof facts.saved === 'boolean') {
    if(facts.t3Saved!==undefined&&facts.t3Saved!==null&&typeof facts.t3Saved!=='boolean'||facts.t3Configured!==undefined&&typeof facts.t3Configured!=='boolean')throw Error('Invalid T3 preference');
    if(facts.autoPasteSaved!==undefined&&facts.autoPasteSaved!==null&&typeof facts.autoPasteSaved!=='boolean'||facts.autoPasteSupported!==undefined&&typeof facts.autoPasteSupported!=='boolean')throw Error('Invalid auto paste preference');
    let origin:string|undefined;
    if(typeof facts.t3Origin==='string'&&facts.t3Origin.length<=2048)try{
      const url=new URL(facts.t3Origin);
      if(url.origin===facts.t3Origin&&!url.username&&!url.password&&['http:','https:'].includes(url.protocol))origin=url.origin;
    }catch{/* Do not expose malformed private config as page text. */}
    const expiry=typeof facts.t3ExpiresAt==='number'&&Number.isFinite(facts.t3ExpiresAt)?facts.t3ExpiresAt:undefined;
    if(facts.sharingSaved!==undefined&&facts.sharingSaved!==null&&typeof facts.sharingSaved!=='boolean')throw Error('Invalid sharing preference');
    return {...facts.sharingSaved===undefined?{}:{sharingSaved:facts.sharingSaved as boolean|null},...facts.autoPasteSaved===undefined?{}:{autoPasteSaved:facts.autoPasteSaved as boolean|null},...facts.autoPasteSupported===undefined?{}:{autoPasteSupported:facts.autoPasteSupported as boolean},saved:facts.saved,...facts.t3Saved===undefined?{}:{t3Saved:facts.t3Saved as boolean|null},...facts.t3Configured===undefined?{}:{t3Configured:facts.t3Configured as boolean},...origin?{t3Origin:origin}:{},...expiry===undefined?{}:{t3ExpiresAt:expiry}};
  }
  throw Error('Invalid Agents preference');
}

// Private parent-pipe requests have bounded IDs/deadlines. A timeout has an
// uncertain outcome: read again rather than claiming a saved value.
export class AgentsPreferences {
  private next = 0;
  private pending = new Map<number, {resolve: (facts: PreferenceFacts) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}>();
  private send: (message: object) => void;
  constructor(send: (message: object) => void) { this.send = send; }
  request(enabled?: unknown,setting:'video'|'t3'|'autoPaste'|'sharing'='video'): Promise<PreferenceFacts> {
    if (enabled !== undefined && typeof enabled !== 'boolean') return Promise.reject(Error('Invalid preference'));
    return this.issue({action:'agents-preference',...(enabled===undefined?{}:{enabled}),...(setting==='video'?{}:{setting})});
  }
  storeConnection(connection:T3Connection|null):Promise<PreferenceFacts> {
    return this.issue({action:'agents-connection',connection});
  }
  private issue(message:object):Promise<PreferenceFacts> {
    if (this.pending.size) return Promise.reject(Error('Preference request pending'));
    const request = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(request); reject(Error('Preference acknowledgement timed out')); }, 3500);
      this.pending.set(request, {resolve, reject, timer});
      try { this.send({...message,request}); }
      catch { clearTimeout(timer); this.pending.delete(request); reject(Error('Preference unavailable')); }
    });
  }
  receive(value: {request?: unknown; facts?: unknown}) {
    if (typeof value.request !== 'number') return;
    const pending = this.pending.get(value.request);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(value.request);
    try { pending.resolve(preferenceFacts(value.facts)); }
    catch { pending.reject(Error('Invalid preference acknowledgement')); }
  }
  close() {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Error('Settings closed')); }
    this.pending.clear();
  }
}
