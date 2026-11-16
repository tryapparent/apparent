import {needsChannelRelease} from '../../src/settings/update-policy.ts';

const input = process.argv[2];
if (!input || input.length > 2048) throw Error('Invalid update facts');
process.stdout.write(JSON.stringify(needsChannelRelease(JSON.parse(input))));
