import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import path from 'node:path';

test('onboarding socket setup survives a long system temp path and exits after setup failure',async()=>{
 const root=await mkdtemp('/tmp/apparent-dev-onboard-regression-');
 try {
  const longTemp=path.join(root,'long-system-temporary-directory'.repeat(3));
  await mkdir(longTemp,{mode:0o700});
  const env={...process.env,TMPDIR:longTemp,APPARENT_TEST_ONBOARDING_SETUP_FAILURE:'1'};
  delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-name-pattern=onboarding fast Connect: connected$',path.join(import.meta.dirname,'connect.smoke.ts')],{
   env,encoding:'utf8',timeout:5000,
  });
  assert.equal(result.error,undefined,'a setup error must close its listening server rather than hang');
  assert.equal(result.signal,null);
  assert.equal(result.status,1);
  assert.match(result.stdout,/Controlled fixture failure after socket bind/);
  assert.doesNotMatch(result.stdout,/ENOENT|ENAMETOOLONG/);
 }finally{await rm(root,{recursive:true,force:true});}
});
