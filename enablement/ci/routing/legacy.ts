// Compatibility adapter for the existing explicit native verifier.
import {readFileSync} from 'node:fs';
import {suitePlan} from './consumers.ts';
process.stdout.write(JSON.stringify(suitePlan(JSON.parse(readFileSync(0, 'utf8')))));
