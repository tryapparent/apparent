// Clipboard secrets stay in Electron main. React receives only an origin and a
// short-lived confirmation handle; the native parent alone persists credentials.
import {randomBytes} from 'node:crypto';
import {parsePairingLink,pair} from '../../../../workflow/t3/pair.ts';
import {settingsEnvironments} from '../../../../../../handoff/main/settings-environments.ts';
import {t3SetupPrompt} from '../../../../../../handoff/settings/t3-contract.ts';
export type T3Connection = {origin:string;token:string;expiresAt:number};
export type PairingPreview = {id:string;origin:string};

export function bindT3Setup(io: {
 bind(name: string, handle: () => unknown): void;
 copy(text: string): unknown;
 configPath?: string;
}) {
 io.bind("apparent:agents-t3-copy-setup", () => io.copy(t3SetupPrompt));
 io.bind("apparent:agents-t3-environments", () => io.configPath ? settingsEnvironments(io.configPath) : []);
}
export class PairingLinks {
 private timer?:ReturnType<typeof setTimeout>;
 private pending?:{id:string;link:string;origin:string;expires:number};
 preview(link:string,server?:string):PairingPreview {
  this.clear();const {origin}=parsePairingLink(link,server),id=randomBytes(24).toString('hex');
  this.pending={id,link,origin,expires:Date.now()+120000};this.timer=setTimeout(()=>this.clear(),120000);this.timer.unref();return {id,origin};
 }
 clear(){clearTimeout(this.timer);this.timer=undefined;this.pending=undefined;}
 async connect(id:string,signal:AbortSignal):Promise<T3Connection>{
  const pending=this.pending;this.clear();
  if(!pending||pending.id!==id||Date.now()>pending.expires)throw Error('Paste a fresh pairing code or link.');
  signal.throwIfAborted();return pair(pending.link,signal,pending.origin);
 }
}
