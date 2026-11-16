import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {destinations,type DestinationView,type Project,type Thread} from '../../../src/pill/destinations.ts';
import {connections,Transport,type Connection} from './transport.ts';
import {choiceTarget,Delivery,type Job} from './delivery.ts';
import {Store} from './store.ts';
export class Controller{
 private config:Connection|null=null;private enabled=false;private capture='';private processing=false;private choices:DestinationView['choices']=[];
 private catalogue=new Map<string,{config:Connection;threads:(Thread&Record<string,unknown>)[];project:Project&Record<string,unknown>;settings:Record<string,unknown>;choice:DestinationView['choices'][number]}>();
 private connections=new Map<string,Connection>();
 private operations=new Map<string,Promise<unknown>>();
 private jobs=new Map<string,Job>();private results=new Map<string,string|null>();private error='';private storageAvailable=true;private version=0;private initializing:Promise<void>;
 private delivery:Delivery;private store:Store;private changed:()=>void;readonly configFile:string;
 constructor(changed:()=>void,configFile=process.env.APPARENT_CONFIG??path.join(homedir(),'.config/apparent/config.json')){
  this.changed=changed;this.configFile=configFile;this.store=new Store(path.join(path.dirname(configFile),'t3-handoffs'));
  this.delivery=new Delivery(this.store,origin=>{const config=this.connections.get(origin);if(!config)throw Error('Reconnect the selected T3 environment');return new Transport(config)});
  this.initializing=this.store.load().then(jobs=>{for(const j of jobs)this.jobs.set(j.capture,j);}).catch(()=>{this.storageAvailable=false;this.error='Unable to restore pending handoffs. Recordings are kept.';});
 }
 private exclusive<T>(capture:string,operation:()=>Promise<T>):Promise<T>{
  const before=this.operations.get(capture)??Promise.resolve();const next=before.catch(()=>{}).then(operation);this.operations.set(capture,next);
  void next.finally(()=>{if(this.operations.get(capture)===next)this.operations.delete(capture);}).catch(()=>{});return next;
 }
 confirm(capture:string,id:string){return this.exclusive(capture,()=>this.doConfirm(capture,id));}
 ready(capture:string,text:string|null){return this.exclusive(capture,()=>this.doReady(capture,text));}
 cancel(capture:string){return this.exclusive(capture,()=>this.doCancel(capture));}
 retry(capture:string){return this.exclusive(capture,()=>this.doRetry(capture));}
 view():DestinationView|null{if(!this.enabled||!this.capture)return null;if(!this.config)return {capture:this.capture,choices:[],selected:'',phase:'setup',processing:this.processing};const job=this.jobs.get(this.capture);return {capture:this.capture,choices:this.choices,selected:job&&job.phase!=='cancelled'?[...this.catalogue].find(([,v])=>v.config.origin===job.target.origin&&v.choice.id===(job.target.launch?'new':job.target.threadId))?.[0]??'':this.choices[0]?.id??'',...job&&job.phase!=='cancelled'?{confirmed:{id:job.target.launch?'new':job.target.threadId,title:job.target.title,project:[...this.catalogue.values()].find(v=>v.config.origin===job.target.origin&&v.project.id===job.target.projectId)?.project.title??'',computer:new URL(job.target.origin).host,kind:'active' as const}}:{},phase:job&&job.phase!=='cancelled'?job.phase==='error'?'error':job.phase==='uncertain'?'uncertain':job.phase==='sending'?'sending':job.phase==='sent'?'sent':'armed':this.error?'error':'choosing',processing:this.processing,error:this.error||undefined};}
 text(capture:string){const text=this.results.get(capture)??this.jobs.get(capture)?.text;if(capture!==this.capture||typeof text!=='string')throw Error('Recording is not ready');return text;}
 async update(capture:string,phase:string,eligible=true){
  if(!['processing','completed'].includes(phase)||!eligible){if(this.capture){this.capture='';++this.version;this.changed();}return;}
  if(this.capture===capture){const processing=phase==='processing';if(this.processing!==processing){this.processing=processing;this.changed();}return;}
  this.capture=capture;this.processing=phase==='processing';const version=++this.version;
  await this.initializing;let configured:Connection[]=[],enabled=false;
  try{const saved=JSON.parse(await readFile(this.configFile,'utf8'));enabled=saved.experiments?.t3DestinationPicker===true;configured=enabled?connections(saved.t3):[];}catch{}
  if(version!==this.version)return;this.enabled=enabled;this.config=configured[0]??null;
  this.catalogue.clear();this.choices=[];if(this.storageAvailable)this.error='';this.changed();if(!this.config)return;
  const multiple=configured.length>1;
  const results=await Promise.allSettled(configured.map(async config=>{
   const transport=new Transport(config);
   const [raw,configuration]=await Promise.all([transport.get('/api/orchestration/shell?omitIdleSubagents=true&omitOlderSettled=true') as Promise<{threads:Thread[];projects:Project[]}>,transport.rpc('server.getConfig',{}) as Promise<{settings:Record<string,unknown>}>]);
   if(!Array.isArray(raw.threads)||!Array.isArray(raw.projects)||!configuration.settings)throw Error('Invalid T3 catalogue');
   const projects=raw.projects.filter(p=>!p.archivedAt),last=[...this.jobs.values()].reverse().find(j=>j.target.origin===config.origin)?.target.projectId;
   const projectId=[config.projectId,last,projects[0]?.id].find(id=>projects.some(p=>p.id===id));
   if(!projectId)throw Error('No T3 project');
   return {config,raw,projects,projectId,settings:configuration.settings};
  }));
  if(version!==this.version)return;
  results.forEach((result,i)=>{
   if(result.status==='rejected'){this.error=[this.error,`Couldn’t load ${new URL(configured[i].origin).host}. Retry or copy the recording.`].filter(Boolean).join(' ');return;}
   const {config,raw,projects,projectId,settings}=result.value;
   for(const original of destinations(raw.threads,projects,projectId)){
    const thread=raw.threads.find(t=>t.id===original.id),project=projects.find(p=>p.id===(thread?.projectId??projectId));if(!project)continue;
    const id=multiple?JSON.stringify([config.origin,original.id]):original.id;
    const choice={...original,id,computer:new URL(config.origin).host};
    this.choices.push(choice);this.catalogue.set(id,{config,threads:raw.threads as (Thread&Record<string,unknown>)[],project:project as Project&Record<string,unknown>,settings,choice:original});
   }
  });this.changed();
 }

 private async doConfirm(capture:string,id:string){
  if(capture!==this.capture||!this.config)throw Error('Recording changed');if(!this.storageAvailable)throw Error('Handoff receipts unavailable; copy the recording instead');const existing=this.jobs.get(capture);if(existing&&existing.phase!=='cancelled')throw Error('Handoff already confirmed');
  if(this.results.has(capture)&&this.results.get(capture)===null)throw Error('Recording could not be prepared');
  const entry=this.catalogue.get(id);if(!entry)throw Error('Destination unavailable');
  const {choice,project,config,settings,threads}=entry;
  let workspaceStrategy:object={type:'root'};
  if(choice.id==='new'&&(project.defaultThreadEnvMode??settings.defaultThreadEnvMode)==='worktree'){
   const refs=await new Transport(config).rpc('vcs.listRefs',{cwd:project.workspaceRoot,limit:100}) as {isRepo:boolean;refs:{name:string;isDefault:boolean;isRemote?:boolean}[];hasPrimaryRemote:boolean};
   const base=refs.refs.find(r=>r.isDefault&&r.isRemote)??refs.refs.find(r=>r.isDefault);
   if(refs.isRepo&&!base)throw Error('T3 project has no default branch');
   if(base)workspaceStrategy={type:'worktree',baseRef:base.name,startFromOrigin:!!base.isRemote};
  }
  const runtimeMode=settings.defaultRuntimeMode;
  if(typeof runtimeMode!=='string'||!['approval-required','auto-accept-edits','auto','full-access'].includes(runtimeMode))throw Error('T3 defaults unavailable');
  const target=choiceTarget(choice,threads,project,config.origin,{modelSelection:settings.defaultModelSelection,runtimeMode,workspaceStrategy}),job=this.delivery.create(capture,target,this.results.get(capture)??null);
  await this.store.save(job);this.jobs.set(capture,job);if(capture===this.capture)this.error='';this.changed();if(job.text!==null)await this.send(job);
 }
 private async doReady(capture:string,text:string|null){
  if(typeof capture!=='string'||typeof text!=='string'&&text!==null||text&&text.length>1_500_000)throw Error('Invalid completion');
  await this.initializing;this.results.set(capture,text);while(this.results.size>64)this.results.delete(this.results.keys().next().value!);const job=this.jobs.get(capture);
  if(job?.phase==='armed'){
   try{if(text===null){job.phase='error';await this.store.save(job);if(capture===this.capture)this.error='Recording could not be prepared. The handoff was not sent.';}else{job.text=text;await this.store.save(job);await this.send(job);}}
   catch{if((job as Job).phase!=='uncertain')job.phase='error';if(capture===this.capture)this.error='Handoff not confirmed. Retry or copy the recording.';}
  }
  this.changed();
 }
 private async send(job:Job){
  let config:Connection|null=null;try{config=connections(JSON.parse(await readFile(this.configFile,'utf8')).t3).find(c=>c.origin===job.target.origin)??null;}catch{}
  if(!config||config.origin!==job.target.origin){job.phase='error';await this.store.save(job);if(job.capture===this.capture)this.error='Reconnect the selected T3 environment before retrying.';this.changed();return;}
  // A previously confirmed job may finish after the feature was disabled for a
  // later recording. Its credential must not activate that recording's picker.
  this.connections.set(config.origin,config);
  const sending=this.delivery.submit(job);this.changed();await sending;
  if(job.capture===this.capture)this.error=job.phase==='uncertain'?'T3 has not confirmed delivery. Retry reuses the same request.':'';this.changed();
 }
 private async doRetry(capture:string){if(capture!==this.capture)throw Error('Recording changed');const job=this.jobs.get(capture);if(job&&['uncertain','error'].includes(job.phase)){if(job.text===null)throw Error('Recording unavailable');await this.send(job);}else{this.capture='';await this.update(capture,this.processing?'processing':'completed');}}
 private async doCancel(capture:string){if(capture!==this.capture)throw Error('Recording changed');const job=this.jobs.get(capture);if(job)await this.delivery.cancel(job);this.error='';this.changed();}
}
