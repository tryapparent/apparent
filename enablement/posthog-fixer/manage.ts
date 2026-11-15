import {config} from './config.ts';
import {Store} from './store.ts';

process.umask(0o077);
const c=config(process.env);
const store=new Store(c.stateDirectory, JSON.stringify({project:c.projectId,posthog:c.posthogOrigin,t3:c.t3Origin,projectId:c.t3ProjectId}));
try {
  const [action,issue,...extra]=process.argv.slice(2);
  if(action==='list' && !issue) {
    console.log(JSON.stringify(store.jobs().map(({issue,thread,state,attempts,reserved_at})=>({issue,thread,state,attempts,reserved_at})),null,2));
  } else if(action==='retry' && issue && !extra.length) {
    const job=store.jobs().find(job=>job.issue===issue && job.state==='held');
    if(!job)throw Error('Only a held job can be retried');
    store.update(issue,job.payload ? 'launching':'queued');
    console.log('Retry queued with the original command and thread IDs');
  } else throw Error('Usage: manage.ts list | retry <held-issue-uuid>');
} finally {store.close();}
