type Receipt = {penSaveId?:string;penError:boolean};
type Bridge = {action:(action:string)=>Promise<boolean>;onState:(listener:(state:Receipt)=>void)=>()=>void};

// Dispatch acceptance is not a save receipt. Subscribe first: a fast provider may
// publish its durable result before Electron resolves the dispatch acknowledgement.
export async function savePen(bridge:Bridge|undefined, colour:string, signal:AbortSignal):Promise<void> {
  if(!bridge)throw Error('The app connection was interrupted. Close setup and reopen it from apparent.');
  const id=crypto.randomUUID();
  let stop=()=>{},timer:ReturnType<typeof setTimeout>|undefined;
  let abort=()=>{};
  try {
    await new Promise<void>((resolve,reject)=>{
      abort=()=>reject(Error('Pen selection cancelled.'));
      if(signal.aborted){abort();return;}
      signal.addEventListener('abort',abort,{once:true});
      stop=bridge.onState(state=>{
        if(state.penSaveId!==id)return;
        if(state.penError)reject(Error('The colour could not be saved. Try choosing it again.'));
        else resolve();
      });
      timer=setTimeout(()=>reject(Error('The app did not confirm the save. Try choosing your pen again.')),10000);
      void bridge.action(`pen:${colour}:${id}`).then(accepted=>{
        if(!accepted)reject(Error('The app connection was interrupted. Close setup and reopen it from apparent.'));
      },()=>reject(Error('The app connection was interrupted. Close setup and reopen it from apparent.')));
    });
  } finally {stop();clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
