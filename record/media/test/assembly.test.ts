import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {assemblyPlan} from '../src/assembly-policy.ts';

test('duration defaults preserve the accepted allocation and ordinary-frame reservation', () => {
  for (const [duration, maximum] of [[0n,6],[8000n,6],[39999n,6],[40000n,7],
    [67600n,8],[139999n,11],[140000n,12],[268000n,12],[0xffff_ffff_ffff_ffffn,12]] as const) {
    assert.deepEqual(assemblyPlan(duration), {version:1,maximumFrames:maximum,ordinaryFrames:6});
  }
  assert.throws(() => assemblyPlan(-1n));
  assert.throws(() => assemblyPlan(0x1_0000_0000_0000_0000n));
});

test('the real Node worker accepts an exact native duration and rejects malformed requests privately', () => {
  const worker=fileURLToPath(new URL('../src/assembly-worker.ts',import.meta.url));
  const run=(...args:string[])=>spawnSync(process.execPath,['--experimental-strip-types',worker,...args],
    {encoding:'utf8',timeout:5000});
  const result=run('18446744073709551615');
  assert.equal(result.status,0);assert.equal(result.stderr,'');
  assert.deepEqual(JSON.parse(result.stdout),{version:1,maximumFrames:12,ordinaryFrames:6});
  for(const args of [[],['-1'],['1.5'],['01'],['18446744073709551616'],['40000','PRIVATE SENTINEL'],['PRIVATE SENTINEL']]) {
    const failure=run(...args);assert.equal(failure.status,1);assert.equal(failure.stdout,'');
    assert.equal(failure.stderr,'Record could not plan bundle assembly\n');
  }
});
