import {readFileSync} from 'node:fs';
import {PracticeHost} from '../../../electron/onboarding/practice-host.ts';
const host=new PracticeHost();
let reply;
for(const batch of JSON.parse(readFileSync(0,'utf8')))reply=host.accept(batch);
process.stdout.write(JSON.stringify(reply));
