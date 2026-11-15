import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {closeSync, mkdtempSync, openSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {alignTranscript, type TimedText} from '../../src/transcript/policy.ts';

const unit = (t: bigint, text: string): TimedText => ({t0: t, t1: t + 100n, text});
test('native punctuation and mark anchors partition words without dropping or repeating text', () => {
  assert.deepEqual(alignTranscript([1000n, 4000n], [], {text: '', segments: [], words: [
    unit(0n,'Make'),unit(1000n,'this'),unit(2000n,'smaller'),unit(2100n,','),
    unit(3000n,'and'),unit(4000n,'move'),unit(7000n,'that.'),
  ]}), ['Make this smaller,', 'and move that.']);
  assert.deepEqual(alignTranscript([600n,5000n],[500n,1800n],{text:'',segments:[],words:[
    unit(400n,'First.'),unit(2000n,'Started'),unit(2600n,'drawing'),unit(4800n,'this.'),
  ]}),['First.','Started drawing this.']);
  assert.deepEqual(alignTranscript([1000n,5000n],[],{text:'',segments:[],words:[
    unit(0n,'Lots'),unit(500n,'of'),unit(900n,'glitches'),unit(5000n,'.'),unit(5200n,'Yeah'),
  ]}),['Lots of glitches.','Yeah']);
});

test('segment-only and untimed transcripts retain their native assignment and Unicode whitespace', () => {
  assert.deepEqual(alignTranscript([1000n,5000n],[],{text:'',words:[],segments:[
    {t0:0n,t1:2000n,text:'First thought.'},{t0:4000n,t1:6000n,text:'Second thought.'},
  ]}),['First thought.','Second thought.']);
  assert.deepEqual(alignTranscript([1n,2n],[],{text:'\u0085中文 café\u0085',words:[],segments:[]}),['中文 café',null]);
  assert.deepEqual(alignTranscript([1n],[],{text:'\ufeff',words:[],segments:[]}),['\ufeff']);
  assert.deepEqual(alignTranscript([],[],{text:'No frames',words:[],segments:[]}),[]);
});

test('full native timestamps survive clause allocation without Number rounding', () => {
  const end=0xffff_ffff_ffff_ffffn;
  assert.deepEqual(alignTranscript([end],[],{text:'',segments:[],words:[{t0:end-15n,t1:end,text:'Exact.'}]}),['Exact.']);
  assert.throws(()=>alignTranscript([-1n],[],{text:'',segments:[],words:[]}));
  assert.throws(()=>alignTranscript([end+1n],[],{text:'',segments:[],words:[]}));
});

test('real worker reads finite private stdin and refuses malformed data without disclosure', () => {
  const root=mkdtempSync(join(tmpdir(),'apparent-dev-transcript-'));
  const path=join(root,'request.json'), worker=fileURLToPath(new URL('../../src/transcript/worker.ts',import.meta.url));
  const request={version:1,times:['18446744073709551615'],anchors:[],transcript:{text:'Exact.',words:[],segments:[]}};
  const run=(value:unknown,...args:string[])=>{
    writeFileSync(path,JSON.stringify(value),{mode:0o600});
    const fd=openSync(path,'r');
    try {return spawnSync(process.execPath,['--experimental-strip-types',worker,...args],{stdio:[fd,'pipe','pipe'],encoding:'utf8',timeout:5000});}
    finally {closeSync(fd);}
  };
  try {
    const ok=run(request);assert.equal(ok.status,0);assert.equal(ok.stderr,'');
    assert.deepEqual(JSON.parse(ok.stdout),{version:1,said:['Exact.']});
    for(const invalid of [{...request,version:2},{...request,times:['18446744073709551616']},
      {...request,times:[1]},{...request,extra:'PRIVATE SENTINEL'},'PRIVATE SENTINEL',
      {...request,transcript:{...request.transcript,text:null}}]) {
      const failure=run(invalid);assert.equal(failure.status,1);assert.equal(failure.stdout,'');
      assert.equal(failure.stderr,'Record could not allocate transcript text\n');
    }
    assert.equal(run(request,'PRIVATE SENTINEL').status,1);
  } finally {rmSync(root,{recursive:true,force:true});}
});
