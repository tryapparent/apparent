// Hosted phases reuse the same test inventory as the local push runner.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {consumerTests, integrationTests, packageTests, sourceTests, testCommand} from './checks.ts';

const phases = {source: sourceTests, integration: integrationTests, consumer: consumerTests,
  clean: [...sourceTests, ...packageTests]};
const phase = process.argv[2] as keyof typeof phases;
if (!(phase in phases)) throw Error('Expected source, integration, consumer or clean');
const command = testCommand(phases[phase]);
const result = spawnSync(command.argv[0], command.argv.slice(1), {
  cwd: fileURLToPath(new URL('../../', import.meta.url)), stdio: 'inherit', env: process.env,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
