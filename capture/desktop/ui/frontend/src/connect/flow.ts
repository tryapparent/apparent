import {useEffect, useRef, useState} from 'react';
import type {ConnectAction, ConnectSettings} from './protocol';
import {startConnect, type ConnectBridge} from './consent.ts';
export {startConnect, type ConnectBridge} from './consent.ts';

export function useConnectFlow(bridge: ConnectBridge) {
  const [result, setResult] = useState<ConnectSettings>({status:'disconnected'});
  const [busy, setBusy] = useState(true);
  const [browserFailed,setBrowserFailed]=useState(false);
  const generation = useRef(0), pending = useRef(false), owned = useRef(false), opened = useRef<string|null>(null);
  const readPending=useRef<Promise<void>|null>(null),actionBusy=useRef(false);
  useEffect(() => {
    let active = true;
    let opening = true;
    const refresh = async () => {
      if (pending.current||actionBusy.current) return;
      pending.current = true;
      readPending.current=(async()=>{
        try {
          const first = opening; opening = false;
          const next = await (first && bridge.open ? bridge.open(() => active && !actionBusy.current) : bridge.read());
          if(active) setResult(next);
        }
        catch { if(active) setResult({status:'error'}); }
        finally { pending.current = false; if(active&&!actionBusy.current) setBusy(false); }
      })();
      await readPending.current;readPending.current=null;
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {active=false;generation.current++;clearInterval(timer);bridge.close?.();};
  }, [bridge]);
  async function request(action: ConnectAction) {
    if (actionBusy.current) return;
    actionBusy.current=true;setBusy(true);
    const token = generation.current;
    if(action==='connect'){owned.current=true;opened.current=null;setBrowserFailed(false);}
    if(action==='open-browser')setBrowserFailed(false);
    if(action==='cancel'||action==='disable'||action==='disconnect')owned.current=false;
    try {
      await readPending.current;
      if(token!==generation.current)return;
      pending.current = true;
      const next = await (action==='connect' ? startConnect(bridge,()=>token===generation.current) : bridge.command(action));
      if(token===generation.current) {
        setResult(next);
        if(action==='open-browser'&&next.status==='error')setBrowserFailed(true);
      }
      return next;
    } catch {if(token===generation.current){setResult({status:'error'});if(action==='open-browser')setBrowserFailed(true);}}
    finally {pending.current=false;actionBusy.current=false;if(token===generation.current)setBusy(false);}
  }
  const view = result.status==='connected' ? result.view : undefined;
  useEffect(() => {
    const uri=view?.verificationUri;
    if(!owned.current||busy||!uri||opened.current===uri)return;
    opened.current=uri;
    void request('open-browser');
  }, [view?.verificationUri,busy]);
  return {result, view, busy, request,browserFailed};
}
