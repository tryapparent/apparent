import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {destinations,type DestinationView,type Project,type Thread} from '../../../src/pill/destinations.ts';
import {connection,Transport,type Connection} from './transport.ts';
import {choiceTarget,Delivery,type Job} from './delivery.ts';
import {Store} from './store.ts';
export class Controller{
 private config:Connection|null=null;private capture='';private processing=false;private choices:DestinationView['choices']=[];
 private threads:(Thread&Record<string,unknown>)[]=[];private projects:(Project&Record<string,unknown>)[]=[];private projectId='';
 private settings:Record<string,unknown>={};
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
 view():DestinationView|null{if(!this.config||!this.capture)return null;const job=this.jobs.get(this.capture);return {capture:this.capture,choices:this.choices,selected:job&&job.phase!=='cancelled'?job.target.launch?'new':job.target.threadId:'new',...job&&job.phase!=='cancelled'?{confirmed:{id:job.target.launch?'new':job.target.threadId,title:job.target.title,project:this.projects.find(p=>p.id===job.target.projectId)?.title??'',kind:'active' as const}}:{},phase:job&&job.phase!=='cancelled'?job.phase==='error'?'error':job.phase==='uncertain'?'uncertain':job.phase==='sending'?'sending':job.phase==='sent'?'sent':'armed':this.error?'error':'choosing',processing:this.processing,error:this.error||undefined};}
 text(capture:string){const text=this.results.get(capture)??this.jobs.get(capture)?.text;if(capture!==this.capture||typeof text!=='string')throw Error('Recording is not ready');return text;}
 async update(capture:string,phase:string,eligible=true){
  if(!['processing','completed'].includes(phase)||!eligible){if(this.capture){this.capture='';++this.version;this.changed();}return;}
  if(this.capture===capture){const processing=phase==='processing';if(this.processing!==processing){this.processing=processing;this.changed();}return;}
  this.capture=capture;this.processing=phase==='processing';const version=++this.version;
  await this.initializing;let config:Connection|null=null;
  try{const saved=JSON.parse(await readFile(this.configFile,'utf8'));config=saved.experiments?.t3DestinationPicker===true?connection(saved.t3):null;}catch{}
  if(version!==this.version)return;this.config=config;if(!config){this.changed();return;}
  this.choices=[];if(this.storageAvailable)this.error='';this.changed();
  try{const transport=new Transport(config);
   const [raw,configuration]=await Promise.all([transport.get('/api/orchestration/shell?omitIdleSubagents=true&omitOlderSettled=true') as Promise<{threads:Thread[];projects:Project[]}>,transport.rpc('server.getConfig',{}) as Promise<{settings:Record<string,unknown>}>]);
   if(version!==this.version)return;if(!Array.isArray(raw.threads)||!Array.isArray(raw.projects))throw Error('Invalid T3 catalogue');
   this.threads=raw.threads as typeof this.threads;this.projects=raw.projects.filter(p=>!p.archivedAt) as typeof this.projects;
   this.settings=configuration.settings;
   const last=[...this.jobs.values()].reverse().find(j=>j.target.origin===config.origin)?.target.projectId;
   this.projectId=[config.projectId,last,this.projects[0]?.id].find(id=>this.projects.some(p=>p.id===id))??'';
   this.choices=destinations(raw.threads,raw.projects,this.projectId);if(!this.projectId)throw Error('No T3 project');
  }catch{if(version!==this.version)return;this.error='Unable to load T3 threads. Retry or copy the recording.';}this.changed();
 }
 private async doConfirm(capture:string,id:string){
  if(capture!==this.capture||!this.config)throw Error('Recording changed');if(!this.storageAvailable)throw Error('Handoff receipts unavailable; copy the recording instead');const existing=this.jobs.get(capture);if(existing&&existing.phase!=='cancelled')throw Error('Handoff already confirmed');
  if(this.results.has(capture)&&this.results.get(capture)===null)throw Error('Recording could not be prepared');
  const choice=this.choices.find(c=>c.id===id),project=this.projects.find(p=>p.id===this.projectId);if(!choice||!project)throw Error('Destination unavailable');
  const config=this.config,settings=this.settings,threads=this.threads;
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
  let config:Connection|null=null;try{config=connection(JSON.parse(await readFile(this.configFile,'utf8')).t3);}catch{}
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
