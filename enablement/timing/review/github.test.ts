import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectGitHub} from './github.ts';
import {main} from './index.ts';

test('read-only collector prioritizes old queues, pages jobs and reports run/list caps',()=>{
  const calls:string[][]=[];
  const r=collectGitHub('example/repo','2026-11-17T06:00:00Z','2026-11-17T12:00:00Z',1,args=>{
    calls.push(args);
    if(args[0]==='run'){
      const status=args[args.indexOf('--status')+1];
      if(status==='queued')return [
        {databaseId:2,headSha:'b'.repeat(40),attempt:1,status,createdAt:'2026-11-17T09:00:00Z'},
        {databaseId:1,headSha:'a'.repeat(40),attempt:2,status,createdAt:'2026-11-17T02:00:00Z'}];
      return [];
    }
    assert.match(args[1],/runs\/1\/attempts\/2\/jobs/);
    return args[1].endsWith('page=1') ? {total_count:101,jobs:Array.from({length:100},(_,i)=>({id:i+1}))} : {total_count:101,jobs:[{id:101}]};
  });
  assert.equal(r.runs[0].databaseId,1);
  assert.equal(r.runs[0].jobs.length,101);
  assert.equal(r.runs[0].snapshotCoverage.complete,true);
  assert.equal(r.coverage.jobPages[0].capturedJobs,101);
  assert.equal(r.coverage.runLimitReached,true);
  assert.ok(calls.every(a=>a[0]==='api'||a.slice(0,2).join(' ')==='run list'));
  assert.ok(!calls.find(a=>a.includes('--status')&&a.includes('queued'))?.includes('--created'),'old queues survive window filtering');
});

test('provider errors are access gaps, not CI failures, and no raw provider diagnostic leaks',()=>{
  const r=collectGitHub('example/repo','2026-11-17T06:00:00Z','2026-11-17T12:00:00Z',1,args=>{
    if(args[0]==='run')return args.includes('queued') ? [{databaseId:1,headSha:'a'.repeat(40),attempt:1,status:'queued',createdAt:'2026-11-17T05:00:00Z'}] : [];
    throw Error('private diagnostic');
  });
  assert.equal(r.runs.length,0);
  assert.equal(r.coverage.errors.length,1);
  assert.ok(!JSON.stringify(r).includes('private diagnostic'));
  assert.throws(()=>collectGitHub('bad/repo/extra','','',1,()=>[]),/owner\/repository/);
  assert.throws(()=>collectGitHub('example/repo','','',41,()=>[]),/1–40/);
});

const from='2026-11-17T06:00:00Z', to='2026-11-17T12:00:00Z';
const repo='example/repo', sha='ab'.repeat(20), exact=`90/2/${sha}`;
const attemptPath=`repos/${repo}/actions/runs/90/attempts/2`;
const attempt={id:90,run_attempt:2,head_sha:sha,name:'Synthetic release',status:'completed',
  conclusion:'success',created_at:'2026-11-17T06:01:00Z',updated_at:'2026-11-17T06:33:00Z'};
const job={id:501,run_id:90,run_attempt:2,head_sha:sha,name:'Signed build',runner_id:12,
  status:'completed',conclusion:'success',created_at:'2026-11-17T06:02:00Z',
  started_at:'2026-11-17T06:03:00Z',completed_at:'2026-11-17T06:33:00Z',
  steps:[{number:7,name:'Sign package',status:'completed',conclusion:'success',
    started_at:'2026-11-17T06:13:00Z',completed_at:'2026-11-17T06:33:00Z'}]};

test('ordinary completions cover distinct heads across reserved and remaining slots before repeating',()=>{
  const completed=([
    [100,'a',59,'success'], [101,'a',34,'success'], [102,'a',28,'success'],
    [103,'a',25,'success'], [104,'a',24,'success'], [105,'a',23,'success'],
    [106,'a',22,'success'], [107,'b',21,'skipped'], [108,'b',18,'success'],
    [110,'d',13,'success'], [109,'c',14,'failure'],
  ] as const).map(([databaseId,letter,minute,conclusion])=>({databaseId,headSha:letter.repeat(40),attempt:1,
    status:'completed',conclusion,name:'Verification',createdAt:'2026-11-17T06:01:00Z',
    updatedAt:`2026-11-17T11:${minute}:00Z`}));
  const queued=[4,3,2,1].map(databaseId=>({databaseId,headSha:'a'.repeat(40),attempt:1,
    status:'queued',conclusion:null,name:'Queue',createdAt:`2026-11-16T0${databaseId}:00:00Z`,
    updatedAt:`2026-11-16T0${databaseId}:00:00Z`}));
  const running={...queued[0],databaseId:5,status:'in_progress',name:'Executing'};
  for (const [runs, remaining] of [
    [completed,[100,107,109,110,101,102,103,104,105,106]],
    [completed.filter(run=>run.headSha==='a'.repeat(40)),[100,101,102,103,104,105,106,2,3,4]],
  ] as const) {
    const lists:string[]=[], api:string[]=[];
    const result=collectGitHub(repo,from,to,12,args=>{
      if (args[0]==='run') {
        const status=args[args.indexOf('--status')+1];
        lists.push(status);
        if (status==='queued') return queued;
        if (status==='in_progress') return [running];
        return status==='completed' ? runs : [];
      }
      assert.equal(args[0],'api');
      api.push(args[1]);
      return {total_count:0,jobs:[]};
    });
    const expected=[1,5,...remaining];
    assert.deepEqual(result.runs.map(run=>run.databaseId),expected);
    assert.equal(result.coverage.selectedRuns,12);
    assert.equal(result.coverage.runLimitReached,runs.length+queued.length+1>expected.length);
    assert.deepEqual(lists,['queued','in_progress','waiting','completed']);
    assert.deepEqual(api,expected.map(id=>`repos/${repo}/actions/runs/${id}/attempts/1/jobs?per_page=100&page=1`));
  }
});

function producer(options:{duplicate?:boolean; metadata?:Partial<typeof attempt>; missingMetadata?:boolean; jobs?:'partial'|'failed'}={}) {
  const api:string[]=[];
  const read=(args:string[])=>{
    if (args[0]==='run') {
      assert.deepEqual(args.slice(0,4),['run','list','--repo',repo]);
      if (args.includes('queued')) return [1,2,3].map(databaseId=>({databaseId,attempt:1,headSha:sha,
        name:'Old queue',status:'queued',createdAt:`2026-11-16T0${databaseId}:00:00Z`}));
      return args.includes('completed') ? [{databaseId:90,attempt:options.duplicate ? 2 : 3,headSha:sha,
        status:'completed',createdAt:attempt.created_at,updatedAt:attempt.updated_at}] : [];
    }
    assert.equal(args[0],'api');
    const path=args[1];
    api.push(path);
    if (path===attemptPath) {
      if (options.missingMetadata) throw Error('private diagnostic');
      return {...attempt,...options.metadata};
    }
    if (path===attemptPath+'/jobs?per_page=100&page=1')
      return {total_count:101,jobs:Array.from({length:100},(_,i)=>({...job,id:600+i,conclusion:'skipped',steps:[]}))};
    if (path===attemptPath+'/jobs?per_page=100&page=2') {
      if (options.jobs==='failed') throw Error('private diagnostic');
      return {total_count:101,jobs:options.jobs==='partial' ? [] : [job]};
    }
    assert.match(path,/\/runs\/(?:[123]\/attempts\/1|90\/attempts\/3)\/jobs\?per_page=100&page=1$/);
    return {total_count:0,jobs:[]};
  };
  return {api,read};
}

test('the live CLI fits a known attempt in the capped sample and reports exact job and step references',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'apparent-dev-exact-attempt-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const input=join(dir,'empty.jsonl'), output=join(dir,'aggregate.json'), report=join(dir,'report.md');
  writeFileSync(input,'');
  const source=producer();
  const args=['collect','--input',input,'--workspace','/example','--from',from,'--to',to,'--out',output];
  await main([...args,'--github-repo',repo,'--ci-run-limit','2','--ci-exact-attempt',exact],source.read);
  assert.deepEqual(source.api,[attemptPath,attemptPath+'/jobs?per_page=100&page=1',
    attemptPath+'/jobs?per_page=100&page=2',`repos/${repo}/actions/runs/1/attempts/1/jobs?per_page=100&page=1`]);
  const {jobs}=JSON.parse(readFileSync(output,'utf8'));
  assert.deepEqual(jobs.collection.exactAttempt,{runId:90,attempt:2,headSha:sha,status:'captured'});
  assert.equal(jobs.collection.runLimitReached,true);
  assert.equal(jobs.collection.selectedRuns,2);
  assert.equal(jobs.analysis.coverage.inputJobRows,101);
  const [age]=jobs.analysis.joblessSnapshots;
  assert.equal(jobs.analysis.joblessSnapshots.length,1);
  assert.equal(age.runId,1);
  assert.equal(age.ageSeconds,126000);
  assert.equal(age.windowAgeSeconds,21600);
  assert.deepEqual(jobs.jobs.map((row:{id:string; runnerSeconds:number})=>[row.id,row.runnerSeconds]),[['90:2:501',1800]]);
  await main(['format','--input',output,'--out',report]);
  assert.ok(readFileSync(report,'utf8').includes(`90:2:501, SHA ${sha}, step 7 Sign package: 1200s`));

  const ordinary=producer();
  const baseline=collectGitHub(repo,from,to,2,ordinary.read);
  assert.deepEqual(baseline.runs.map(run=>run.databaseId),[1,90]);
  assert.equal(ordinary.api.length,2);
  assert.ok(!('exactAttempt' in baseline.coverage));
  await assert.rejects(main([...args,'--jobs',input,'--ci-exact-attempt',exact],()=>assert.fail()),/requires --github-repo/);
  const offline=join(dir,'offline.json'), offlineOutput=join(dir,'offline-aggregate.json');
  writeFileSync(offline,JSON.stringify([{databaseId:90,attempt:2,headSha:sha,jobs:[job]}]));
  await main([...args.slice(0,-1),offlineOutput,'--jobs',offline],()=>assert.fail());
  const offlineJobs=JSON.parse(readFileSync(offlineOutput,'utf8')).jobs;
  assert.deepEqual(offlineJobs.jobs,jobs.jobs);
  assert.ok(!('collection' in offlineJobs));
});

test('the exact route is read once and mismatch, missing metadata and partial or failed pages remain explicit',()=>{
  const duplicate=producer({duplicate:true});
  const selected=collectGitHub(repo,from,to,4,duplicate.read,exact);
  assert.deepEqual(selected.runs.map(run=>[run.databaseId,run.attempt]),[[90,2],[1,1],[2,1],[3,1]]);
  assert.equal(selected.coverage.runLimitReached,false);
  assert.equal(duplicate.api.filter(path=>path===attemptPath+'/jobs?per_page=100&page=1').length,1);
  const otherAttempt=collectGitHub(repo,from,to,5,producer().read,exact);
  assert.deepEqual(otherAttempt.runs.filter(run=>run.databaseId===90).map(run=>run.attempt),[2,3]);
  for (const [options,status] of [
    [{metadata:{head_sha:'cd'.repeat(20)}},'identity-mismatch'],
    [{metadata:{run_attempt:3}},'identity-mismatch'],
    [{metadata:{created_at:'2026-11-17T12:01:00Z'}},'after-cutoff'],
    [{missingMetadata:true},'metadata-unavailable'],
    [{jobs:'partial'},'jobs-incomplete'],[{jobs:'failed'},'jobs-unavailable'],
  ] as const) {
    const source=producer({...options,duplicate:true});
    const result=collectGitHub(repo,from,to,2,source.read,exact);
    assert.equal(result.coverage.exactAttempt?.status,status);
    assert.equal(result.coverage.selectedRuns,2);
    assert.ok(result.runs.some(run=>run.databaseId===1));
    assert.ok(!JSON.stringify(result).includes('private diagnostic'));
    if (status==='identity-mismatch' || status==='metadata-unavailable' || status==='after-cutoff') {
      assert.ok(!source.api.some(path=>path.startsWith(attemptPath+'/jobs')));
    } else if (status==='jobs-incomplete') {
      assert.deepEqual(result.coverage.jobPages[0],{runId:90,attempt:2,pages:2,expectedJobs:101,capturedJobs:100,complete:false});
    } else {
      assert.deepEqual(result.runs.map(run=>run.databaseId),[1]);
      assert.equal(result.coverage.errors[0].runId,90);
    }
  }
  assert.throws(()=>collectGitHub(repo,from,to,2,()=>assert.fail(),'90/2/abcd'),/FULL_HEAD_SHA/);
});
