import {target} from './target.ts';
import {readFileSync, writeFileSync, lstatSync} from 'node:fs';
import {Qmp, sendPlan, qualify, validatePlan} from './qmp.ts';

const abort = new AbortController();
process.on('SIGINT', () => abort.abort());
process.on('SIGTERM', () => abort.abort());
const [mode, source, destination] = process.argv.slice(2);
try {
  if (mode === 'send' && source && destination) {
    const info = lstatSync(source);
    if (!info.isSocket() || info.uid !== process.getuid?.()) throw Error('QMP must be an owned Unix socket');
    const plan = JSON.parse(readFileSync(destination, 'utf8'));
    validatePlan(plan); // refuse invalid plans before connecting or changing input
    console.log(JSON.stringify(await sendPlan(new Qmp(source), plan, 10000, abort.signal)));
  } else if (mode === 'qualify' && source) {
    console.log(JSON.stringify(qualify(JSON.parse(readFileSync(source, 'utf8')))));
  } else if (mode === 'target' && source) {
    // Synthetic owned browser page. All events come from the renderer's native input path.
    writeFileSync(source, target, {mode: 0o600, flag: 'wx'});
  } else throw Error('Usage: node --experimental-strip-types cli.ts send <owned-qmp.sock> <plan.json> | qualify <events.json> | target <new.html>');
} catch (error) { console.error(String(error)); process.exitCode = 1; }
