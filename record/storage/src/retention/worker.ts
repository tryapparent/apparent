import {fstatSync,readFileSync} from 'node:fs';
import {isRetentionPolicy} from '../policy.js';
import {selectCapacityCaptures,storageLimitValid} from './size-limit.js';
import {planRetention,type RetentionFacts} from './policy.js';

const LIMIT=16*1024*1024;
function object(value: unknown, keys: string[]): Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw Error('Invalid request');
  return value as Record<string,unknown>;
}
function unsigned(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) throw Error('Invalid request');
  const number=BigInt(value);if(number>0xffff_ffff_ffff_ffffn)throw Error('Invalid request');return number;
}
function optionalText(value: unknown): string | null {
  if(value!==null && typeof value!=='string')throw Error('Invalid request');return value;
}
try {
  const input=fstatSync(0);if(process.argv.length!==2 || !input.isFile() || input.size>LIMIT)throw Error('Invalid request');
  const bytes=readFileSync(0);if(bytes.length>LIMIT)throw Error('Invalid request');
  const raw = JSON.parse(bytes.toString('utf8'));
  const keys = ['version','mode','policy','observations'];
  if (raw && Object.hasOwn(raw, 'capacity')) keys.push('capacity');
  const request=object(raw,keys);
  if(request.version!==1 || !isRetentionPolicy(request.policy) || !Array.isArray(request.observations)
    || (request.mode!=='pass' && request.mode!=='shrinkOnly'))throw Error('Invalid request');
  const facts:RetentionFacts[]=request.observations.map(value=>{
    const row=object(value,['ageMs','unchangedMs','source','capture','durationMs','videoBytes','heavyMedia']);
    if(typeof row.heavyMedia!=='boolean')throw Error('Invalid request');
    return {ageMs:unsigned(row.ageMs),unchangedMs:unsigned(row.unchangedMs),source:optionalText(row.source),
      capture:optionalText(row.capture),durationMs:unsigned(row.durationMs),
      videoBytes:row.videoBytes===null?null:unsigned(row.videoBytes),heavyMedia:row.heavyMedia};
  });
  const capacityMode = keys.includes('capacity');
  const policy = capacityMode ? {mediaDays:null, bundleDays:null} : request.policy;
  let actions = planRetention(policy, facts, request.mode);
  if (capacityMode) {
    const cap = object(request.capacity, ['maximumMb', 'total', 'sizes']);
    if (request.mode !== 'pass' || !storageLimitValid(cap.maximumMb) || !Array.isArray(cap.sizes) || cap.sizes.length !== facts.length)
      throw Error('Invalid capacity request');
    const total = unsigned(cap.total);
    const sized = facts.map(({ageMs, unchangedMs}, index) => ({ageMs, unchangedMs, size:unsigned((cap.sizes as unknown[])[index])}));
    const selected = selectCapacityCaptures(cap.maximumMb, total, sized);
    actions = [...Array.from(selected, index => ({index, kind:'trashBundle' as const})),
      ...actions.filter(({index}) => !selected.has(index))];
  }
  const output=JSON.stringify({version:1,actions})+'\n';
  if(Buffer.byteLength(output)>LIMIT)throw Error('Invalid response');process.stdout.write(output);
} catch {
  process.stderr.write('Record could not plan retention\n');process.exitCode=1;
}
