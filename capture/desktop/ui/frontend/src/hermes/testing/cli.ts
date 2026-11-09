#!/usr/bin/env -S node --experimental-strip-types
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const file = process.env.APPARENT_SYNTHETIC_RECEIPT!;
const trace = process.env.APPARENT_SYNTHETIC_TRACE!;
appendFileSync(trace, JSON.stringify(args) + '\n');
let receipt: { capture_id: string; status: string; source?: string };
if (args[0] === 'launch') process.exit(0);
if (args[1] === 'state') { console.log('{"state":{"phase":"idle"}}'); process.exit(0); }
if (args[1] === 'start') {
  receipt = { capture_id: args[args.indexOf('--request-id') + 1], status: 'recording' };
  writeFileSync(file, JSON.stringify(receipt));
} else {
  receipt = JSON.parse(readFileSync(file, 'utf8'));
  if (args[1] === 'inspect') receipt.status = 'saved';
  if (args[1] === 'handoff') receipt.source = '/synthetic/owned.apparent';
}
console.log(JSON.stringify(receipt));
