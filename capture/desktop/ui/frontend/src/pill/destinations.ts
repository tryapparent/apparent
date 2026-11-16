// Public presentation data only. Credentials, capture paths and handoff text stay in main.
export type Destination = {id:string;title:string;project:string;computer?:string;kind:'new'|'pinned'|'working'|'active'|'snoozed'};
export type DestinationView = {capture:string;choices:Destination[];selected:string;confirmed?:Destination;phase:'setup'|'choosing'|'armed'|'sending'|'sent'|'error'|'uncertain';processing:boolean;error?:string};
export type Thread = {id:string;projectId:string;title:string;createdAt:string;updatedAt:string;unsettledAt?:string|null;archivedAt?:string|null;deletedAt?:string|null;settledOverride?:string|null;settledAt?:string|null;pinnedAt?:string|null;pinOrderKey?:string|null;activeOrderKey?:string|null;snoozedUntil?:string|null;lastSnoozeWakeAt?:string|null;lineage?:{relationshipToParent?:string|null};status?:string};
export type Project = {id:string;title:string;createdAt?:string;archivedAt?:string|null};
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const timestamp=(value?:string|null)=>value?Date.parse(value)||0:0;
const working=new Set(['preparing','queued','starting','running','waiting']);
export function destinations(threads:Thread[],projects:Project[],projectId:string,now=Date.now()):Destination[]{
 const names=new Map(projects.filter(p=>!p.archivedAt).map(p=>[p.id,p.title]));
 const rows=threads.filter(t=>!t.archivedAt&&!t.deletedAt&&t.settledOverride!=='settled'&&!(t.settledAt&&t.settledOverride!=='active')&&t.lineage?.relationshipToParent!=='subagent'&&names.has(t.projectId));
 const snoozed=(t:Thread)=>!!t.snoozedUntil&&Date.parse(t.snoozedUntil)>now;
 const shelf=(t:Thread)=>snoozed(t)?2:t.pinnedAt?0:1;
 rows.sort((a,b)=>{const group=shelf(a)-shelf(b);if(group)return group;
  if(shelf(a)===2)return Date.parse(a.snoozedUntil!)-Date.parse(b.snoozedUntil!)||compare(a.id,b.id);
  const ak=shelf(a)===0?a.pinOrderKey:a.activeOrderKey,bk=shelf(b)===0?b.pinOrderKey:b.activeOrderKey;
  if(ak||bk){if(!ak)return 1;if(!bk)return -1;const order=compare(ak,bk);if(order)return order;}
  const activity=(t:Thread)=>Math.max(timestamp(t.createdAt),timestamp(t.unsettledAt),timestamp(t.lastSnoozeWakeAt));
  const at=shelf(a)===0?timestamp(a.pinnedAt):activity(a),bt=shelf(b)===0?timestamp(b.pinnedAt):activity(b);
  return bt-at||compare(a.id,b.id);
 });
 return [{id:'new',title:'New thread',project:names.get(projectId)??'',kind:'new'},...rows.map(t=>({id:t.id,title:t.title,project:names.get(t.projectId)!,kind:snoozed(t)?'snoozed' as const:t.pinnedAt?'pinned' as const:working.has(t.status??'')?'working' as const:'active' as const}))];
}
export function visibleDestinations(choices:Destination[],index:number){const start=Math.max(0,Math.min(index-1,choices.length-3));return {start,rows:choices.slice(start,start+3)};}
