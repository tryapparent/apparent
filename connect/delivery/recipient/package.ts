/** Assembly only. The checked-in adoption state switches all packaging routes together. */
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { stage, type StagePin } from './stage.ts';
import { targets } from './seal.ts';
export function assemble(mapFile: string, target: string, destination: string, signing: string[] = [], dependencies = { stage, run: execFileSync }) {
 const map = JSON.parse(readFileSync(mapFile, 'utf8')) as {schema:number; adopted:boolean; pins:Record<string,StagePin>};
 if (map.schema !== 1 || typeof map.adopted !== 'boolean') throw Error('Invalid adoption map');
 if (!targets.includes(target)) throw Error('Unsupported native target');
 if (!map.adopted) { if(Object.keys(map.pins).length) throw Error('Unreviewed partial adoption'); return; }
 if (targets.some(t => !map.pins[t] || map.pins[t].target !== t)) throw Error('All reviewed target pins required');
 const output = join(destination, 'recipient');
 if (existsSync(output)) throw Error('Recipient destination already exists');
 const temporary = mkdtempSync(join(destination, '.recipient-package-'));
 try {
 const pin = join(temporary,'pin.json'); writeFileSync(pin,JSON.stringify(map.pins[target]));
 const staged = join(temporary,'staged'); dependencies.stage(pin,target,staged);
 const executable = join(staged,'apparent-connect-recipient');
 copyFileSync(join(staged,'manifest.json'),join(staged,'recipient-provenance.json'));
 if (target.endsWith('apple-darwin')) {
 if(signing[0] !== 'codesign') throw Error('Mac nested signing required');
 dependencies.run(signing[0],[...signing.slice(1),executable]);
 dependencies.run('codesign',['--verify','--strict',executable]);
 } else if(signing.length) throw Error('Unexpected Linux signing');
 const manifest = JSON.parse(readFileSync(join(staged,'manifest.json'),'utf8'));
 manifest.sha256 = createHash('sha256').update(readFileSync(executable)).digest('hex');
 writeFileSync(join(staged,'manifest.json'),JSON.stringify(manifest)+'\n');
 renameSync(staged, output);
 } finally { rmSync(temporary,{recursive:true,force:true}); }
}
if(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) assemble(process.argv[2],process.argv[3],process.argv[4],process.argv.slice(5));
