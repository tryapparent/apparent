import {config} from './config.ts';
import {Store} from './store.ts';

process.umask(0o077);
const c=config(process.env);
const store=new Store(c.stateDirectory, JSON.stringify({project:c.projectId,posthog:c.posthogOrigin,t3:c.t3Origin,projectId:c.t3ProjectId}));
try {
  const [action,issue,...extra]=process.argv.slice(2);
  if(action==='list' && !issue) {
    console.log(JSON.stringify(store.jobs().map(({issue,thread,batch_thread,state,attempts,reserved_at,spike})=>
      ({issue,thread:batch_thread ?? thread,state,attempts,reserved_at,...(spike ? {posthog_issue:spike.issue} : {})})),null,2));
  } else if(action==='retry' && issue && !extra.length) {
    const jobs=store.jobs();
    const member=jobs.find(job=>job.issue===issue && job.state==='held');
    const job=member?.batch_thread ? jobs.find(job=>job.thread===member.batch_thread) : member;
    if(!job)throw Error('Only a held job can be retried');
    store.update(job.issue,job.payload ? 'launching':'queued');
    console.log('Retry queued with the original command and thread IDs');
  } else throw Error('Usage: manage.ts list | retry <held-issue-uuid>');
} finally {store.close();}
