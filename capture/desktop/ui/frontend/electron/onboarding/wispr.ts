import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

export type WisprResult = {status:'disabled'|'running'|'closed'|'refused'|'unknown'};
export type WisprContext = {platform?:string;step?:string;fix?:boolean;shortcutChosen?:boolean;wisprFlowEnabled?:boolean};
export const wisprExperiment = 'onboardingWisprFlow';

// AppKit calls, not Apple Events: no launch, force-quit or Automation grant.
// Both identity and operations are fixed; no renderer-supplied program or app ID.
export const wisprScript = String.raw`function run(argv) {
  ObjC.import('AppKit');
  function applications() { return $.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.electron.wispr-flow'); }
  if (argv[0] !== 'read' && argv[0] !== 'quit') throw Error('Invalid operation');
  if (argv[0] === 'read') return JSON.stringify({status: applications().count > 0 ? 'running' : 'closed'});
  var apps = applications();
  for (var i = 0; i < apps.count; i++) {
    if (!apps.objectAtIndex(i).terminate) return JSON.stringify({status:applications().count === 0 ? 'closed' : 'refused'});
  }
  var deadline = Date.now() + 5000;
  while (applications().count > 0 && Date.now() < deadline) {
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
  }
  return JSON.stringify({status: applications().count === 0 ? 'closed' : 'refused'});
}`;

export function macWispr(operation:'read'|'quit',signal:AbortSignal):Promise<WisprResult> {
  if(process.platform!=='darwin')return Promise.resolve({status:'disabled'});
  return new Promise(resolve=>{
    execFile('/usr/bin/osascript',['-l','JavaScript','-e',wisprScript,operation],
      {timeout:6500,maxBuffer:4096,signal},(error,stdout)=>{
        if(error){resolve({status:'unknown'});return;}
        try {
          const value=JSON.parse(stdout.trim());
          resolve(['running','closed','refused'].includes(value?.status)?{status:value.status}:{status:'unknown'});
        }catch{resolve({status:'unknown'});}
      });
  });
}

export function eligibleWispr(context:WisprContext|null):boolean {
  return context?.platform==='macos'&&context.wisprFlowEnabled===true&&context.step==='shortcut'
    &&context.fix!==true&&context.shortcutChosen!==true;
}

// Desktop TypeScript owns admission. Native only supplies running/exit facts.
export class WisprOnboarding {
  private active:AbortController|null=null;
  private revision=0;
  private context:()=>WisprContext|null;
  private enabled:()=>Promise<boolean>;
  private provider:typeof macWispr;
  private platform:string;
  constructor(context:()=>WisprContext|null,enabled:()=>Promise<boolean>,provider=macWispr,platform:string=process.platform) {
    this.context=context;this.enabled=enabled;this.provider=provider;this.platform=platform;
  }
  close(){this.revision++;this.active?.abort();this.active=null;}
  async request(operation:unknown):Promise<WisprResult> {
    if(operation!=='read'&&operation!=='quit')throw Error('Forbidden Wispr operation');
    if(this.active)return {status:'unknown'};
    const revision=this.revision;
    if(this.platform!=='darwin'||!eligibleWispr(this.context())||!await this.enabled()
      ||revision!==this.revision||!eligibleWispr(this.context()))return {status:'disabled'};
    // Recheck after async config admission: overlapping requests cannot both quit.
    if(this.active)return {status:'unknown'};
    const controller=new AbortController();this.active=controller;
    try {
      const result=await this.provider(operation,controller.signal);
      return revision===this.revision&&eligibleWispr(this.context())?result:{status:'disabled'};
    }catch{return {status:'unknown'};}
    finally{if(this.active===controller)this.active=null;}
  }
}

export async function savedWisprExperiment(home:string):Promise<boolean> {
  try {
    const config=JSON.parse(await readFile(path.join(home,'.config/apparent/config.json'),'utf8'));
    return config?.experiments?.[wisprExperiment]===true;
  }catch{return false;}
}
