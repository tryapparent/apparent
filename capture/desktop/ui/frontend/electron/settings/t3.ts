// Clipboard secrets stay in Electron main. React receives only an origin and a
// short-lived confirmation handle; the native parent alone persists credentials.
import {randomBytes} from 'node:crypto';
import {parsePairingLink,pair} from '../../../../workflow/t3/pair.ts';
export type T3Connection = {origin:string;token:string;expiresAt:number};
export type PairingPreview = {id:string;origin:string};
export class PairingLinks {
 private timer?:ReturnType<typeof setTimeout>;
 private pending?:{id:string;link:string;expires:number};
 preview(link:string):PairingPreview {
  this.clear();const {origin}=parsePairingLink(link),id=randomBytes(24).toString('hex');
  this.pending={id,link,expires:Date.now()+120000};this.timer=setTimeout(()=>this.clear(),120000);this.timer.unref();return {id,origin};
 }
 clear(){clearTimeout(this.timer);this.timer=undefined;this.pending=undefined;}
 async connect(id:string,signal:AbortSignal):Promise<T3Connection>{
  const pending=this.pending;this.clear();
  if(!pending||pending.id!==id||Date.now()>pending.expires)throw Error('Paste a fresh pairing link.');
  signal.throwIfAborted();return pair(pending.link,signal);
 }
}
