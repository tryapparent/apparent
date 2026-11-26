import type {T3Connection} from '../../../electron/settings/t3.ts';
export const skillCommand = 'bunx skills add https://github.com/tryapparent/apparent/tree/main/agent/skills/apparent';
export type T3ConnectionResult = {facts:PreferenceFacts;reason?:never}|{reason:'cancelled'|'unavailable'|'unconfirmed';facts?:never};
export type PreferenceFacts =
  | {t3Saved: boolean | null; t3Configured?: boolean; t3Origin?: string; t3ExpiresAt?: number; t3Connections?: {origin: string; expiresAt: number}[]}
  | {error: 'config_read_failed' | 'config_write_failed'};
export function preferenceFacts(value: unknown): PreferenceFacts {
  if (!value || typeof value !== 'object') throw Error('Invalid Agents preference');
  const facts = value as Record<string, unknown>;
  if (facts.error === 'config_read_failed' || facts.error === 'config_write_failed') return {error: facts.error};
  if (facts.t3Saved !== null && typeof facts.t3Saved !== 'boolean' ||
      facts.t3Configured !== undefined && typeof facts.t3Configured !== 'boolean') {
    throw Error('Invalid T3 preference');
  }
  let origin:string|undefined;
  if(typeof facts.t3Origin==='string'&&facts.t3Origin.length<=2048)try{
    const url=new URL(facts.t3Origin);
    if(url.origin===facts.t3Origin&&!url.username&&!url.password&&['http:','https:'].includes(url.protocol))origin=url.origin;
  }catch{/* Do not expose malformed private config as page text. */}
  const expiry=typeof facts.t3ExpiresAt==='number'&&Number.isFinite(facts.t3ExpiresAt)?facts.t3ExpiresAt:undefined;
  const connections=Array.isArray(facts.t3Connections)?facts.t3Connections.slice(0,32).flatMap(value=>{
    if(!value||typeof value!=='object')return [];
    const row=value as Record<string,unknown>;
    try{const u=new URL(String(row.origin));if(u.origin!==row.origin||u.username||u.password||!['http:','https:'].includes(u.protocol)||typeof row.expiresAt!=='number'||!Number.isFinite(row.expiresAt))return [];return [{origin:u.origin,expiresAt:row.expiresAt}];}catch{return [];}
  }):undefined;
  return {
    t3Saved: facts.t3Saved,
    ...(facts.t3Configured === undefined ? {} : {t3Configured: facts.t3Configured}),
    ...(origin ? {t3Origin: origin} : {}),
    ...(expiry === undefined ? {} : {t3ExpiresAt: expiry}),
    ...(connections ? {t3Connections: connections} : {}),
  };
}

export class AgentsPreferences {
  private next = 0;
  private pending = new Map<number, {resolve: (facts: PreferenceFacts) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}>();
  private send: (message: object) => void;
  constructor(send: (message: object) => void) { this.send = send; }
  request(enabled?: unknown): Promise<PreferenceFacts> {
    if (enabled !== undefined && typeof enabled !== 'boolean') return Promise.reject(Error('Invalid preference'));
    return this.issue({action:'agents-preference',...(enabled===undefined?{}:{enabled, setting:'t3'})});
  }
  storeConnection(connection:T3Connection|null,disconnect?:string):Promise<PreferenceFacts> {
    return this.issue({action:'agents-connection',connection,...disconnect?{disconnect}:{}});
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

// Labs owns two acknowledged sections sharing one private native pipe. Recheck
// cancellation at dispatch, after any earlier read or preference has settled.
export class PreferenceQueue {
 private tail:Promise<unknown>=Promise.resolve();
 run<T>(operation:()=>Promise<T>,active:()=>boolean=()=>true,signal?:AbortSignal):Promise<T>{
  const next=this.tail.then(()=>{signal?.throwIfAborted();if(!active())throw Error('Settings closed');return operation();});
  this.tail=next.catch(()=>{});return next;
 }
}
