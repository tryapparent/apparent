/** Fresh offline installed-package proof. No worker, socket, GUI or model launch. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const native = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(native, '../..');
const sdk = process.argv[2] && resolve(process.argv[2]);
const fixturePath = process.argv[3] && resolve(process.argv[3]);
if (!sdk || process.argv.length > 4) throw new Error('Usage: node scripts/check-ink-sdk.ts <exact-sdk046-tar> [native-controller-fixture]');
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const expected = 'de497411db00713eac4ce0e1df81da48513eecb247897a3dfc79a759a6ff16a4';
assert.equal(sha(sdk), expected, 'Use the exact paired SDK046 static artifact; never substitute installed045');
const base = process.env.XDG_STATE_HOME || join(process.env.HOME!, '.local/state');
const owner = join(base, 'apparent'); mkdirSync(owner, { recursive: true, mode: 0o700 });
const proof = mkdtempSync(join(owner, 'ink-sdk046-proof-')); chmodSync(proof, 0o700);
function run(name: string, command: string, args: string[], cwd: string) {
  try {
    const output = execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000,
      env: { ...process.env, npm_config_offline: 'true', ELECTRON_SKIP_BINARY_DOWNLOAD: '1' }, maxBuffer: 4 * 1024 * 1024 });
    writeFileSync(join(proof, name + '.log'), output, { mode: 0o600 }); return output;
  } catch (error) { writeFileSync(join(proof, name + '.log'), String(error), { mode: 0o600 }); throw error; }
}
const packs = join(proof, 'packages'); mkdirSync(packs, { mode: 0o700 });
for (const cwd of [join(root, 'shared/contracts'), native]) run('pack-' + (cwd === native ? 'native' : 'contracts'), 'npm', ['pack', '--pack-destination', packs], cwd);
const consumer = join(proof, 'consumer'); mkdirSync(consumer, { mode: 0o700 });
writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }), { mode: 0o600 });
run('install', 'npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', sdk,
  join(packs, 'apparent-native-host-0.1.0.tgz'), join(packs, 'apparent-app-contracts-0.1.0.tgz')], consumer);
writeFileSync(join(consumer, 'consumer.ts'), `import type {CaptureInkPort,InkSourceObservation} from '@apparent/engine-sdk/capture';
import type {NativeInkSink,NativeInkObservation} from '@apparent/native-host/ink';
declare const engine:CaptureInkPort; const sink:NativeInkSink=engine;
declare const native:NativeInkObservation; const observed:InkSourceObservation=native;
void sink;void observed;\n`, { mode: 0o600 });
run('types', process.execPath, [join(root, 'composition/app/node_modules/typescript/bin/tsc'), '--strict', '--noEmit', '--skipLibCheck', '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--types', 'node', '--typeRoots', join(root, 'composition/app/node_modules/@types'), 'consumer.ts'], consumer);
run('plain-node', process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict';
import {createHash} from 'node:crypto'; import {readFileSync} from 'node:fs';
import {CaptureClient,CAPTURE_INK_LIMITS} from '@apparent/engine-sdk/capture';
import {createNativeInkRelay,createNativeInkSourcePort} from '@apparent/native-host/ink';
assert.equal(typeof createNativeInkRelay,'function');assert.equal(typeof createNativeInkSourcePort,'function');
for(const name of ['registerInkProducer','submitInkEvents','finishInkProducer'])assert.equal(typeof CaptureClient.prototype[name],'function');
assert.equal(CAPTURE_INK_LIMITS.maxBatchJsonBytes,16384);
assert.equal(JSON.parse(readFileSync('node_modules/@apparent/engine-sdk/package.json','utf8')).version,'0.4.6');
console.log('Fresh installed SDK046 and native ink public exports; no native operation invoked');`], consumer);
if (fixturePath) {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  writeFileSync(join(consumer, 'native-controller-fixture.json'), JSON.stringify(fixture), { mode: 0o600 });
  run('actual-sdk-protocol', process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs';
import {CaptureClient,CAPTURE_INK_LIMITS} from '@apparent/engine-sdk/capture';
import {createNativeInkRelay,createNativeInkSourcePort} from '@apparent/native-host/ink';
const f=JSON.parse(readFileSync('native-controller-fixture.json','utf8'));
const original={captureId:f.observed.captureId,source:f.observed.source,ownerToken:'a'.repeat(64)};
const registrationId='c'.repeat(32), producerToken='d'.repeat(64), methods=[];
let sent=0,acked=0,activated=false;
const client=new CaptureClient({async request(r){
 methods.push(r.method);let result;
 if(r.method==='handshake')result={channel:'capture',protocolVersion:2,implementation:'native',readiness:'unavailable',capabilities:Object.fromEntries(['sourceDiscovery','displayCapture','areaCapture','audioCapture','contextFacts','interactionFacts','candidates','transcript','strokes','publication','retainedMaterials'].map(k=>[k,false]))};
 else if(r.method==='registerInkProducer')result={ingressVersion:1,captureId:r.captureId,producerId:r.observation.producerId,generation:r.observation.generation,registrationId,producerToken,nextSequence:0,clock:{kind:r.observation.clock,bootId:r.observation.bootId,admissionMonotonicNs:'0'},limits:CAPTURE_INK_LIMITS};
 else if(r.method==='submitInkEvents'){assert.equal(activated,true);assert.equal(r.eventsJson,f.batches[sent].eventsJson);sent++;result={ingressVersion:1,captureId:r.captureId,registrationId,sequence:r.sequence,batchSha256:r.batchSha256,nextSequence:r.sequence+1,outcome:'accepted'};}
 else if(r.method==='finishInkProducer'){assert.equal(acked,f.batches.length);result={ingressVersion:1,captureId:r.captureId,registrationId,finalSequence:r.finalSequence,state:'complete'};}
 else throw Error('unexpected method');
 return {channel:'capture',protocolVersion:2,rpcId:r.rpcId,result};},async close(){throw Error('lifetime action forbidden in offline test');}});
await client.handshake();
const source={async readObservation(){return f.observed;},async activateInput(binding,clock){assert.equal(binding.captureId,original.captureId);assert.equal(clock.bootId,f.observed.observation.bootId);activated=true;return {status:'active'};},async readBatch(binding,sequence){assert.equal(activated,true);return sequence<f.batches.length?{status:'batch',batch:f.batches[sequence]}:{status:'pending'};},async acknowledgeBatch(binding,b){assert.equal(sent,acked+1);assert.equal(b.batchSha256,f.batches[acked].batchSha256);acked++;return {status:'acknowledged',...b};},async sealInputAndDrain(){return f.seal;}};
const relay=createNativeInkRelay({source,sink:client,original,ownedHost:f.observed.observation.host});
await relay.register();await relay.finish();assert.equal(relay.phase(),'complete');assert.equal(sent,f.batches.length);
const before=methods.length;await assert.rejects(client.submitInkEvents({ingressVersion:1,ownerToken:original.ownerToken,captureId:original.captureId,registrationId,producerToken,sequence:0,eventsJson:'[]',batchSha256:'0'.repeat(64)}));assert.equal(methods.length,before,'invalid batch refused before transport');
console.log('Actual SDK046 validation + NativeInkRelay preserve native-controller bytes/ACK/seal; synthetic transport only, NOT native acceptance');`], consumer);
}
assert.equal(sha(sdk), expected, 'input changed during proof');
writeFileSync(join(proof, 'proof.json'), JSON.stringify({ sdkSha256: expected, nativeTarSha256: sha(join(packs, 'apparent-native-host-0.1.0.tgz')),
  checks: ['fresh offline install', 'strict packed declarations', 'plain Node public exports', ...(fixturePath ? ['actual SDK046 protocol + native-controller fixture'] : [])],
  limits: 'static packages only; no native source/effect, SDK worker, model, socket, GUI or CI/main admission' }, null, 2), { mode: 0o600 });
console.log(proof);
