import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectGitHub} from './github.ts';

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
