import {probeMovie} from '@apparent/engine-sdk';
import {bundleProbe, exportProbe} from './policy.ts';

// One finite read-only request. The native parent supplies explicit packaged
// capabilities; this process never discovers, downloads or builds a provider.
const [executable, movie, operation, ...extra] = process.argv.slice(2);
const abort = new AbortController();
process.once('SIGTERM', () => abort.abort());
try {
  if (!executable || !movie || extra.length || ![undefined, 'export-v1', 'bundle-v1'].includes(operation))
    throw new Error('Invalid Record media request');
  const facts = await probeMovie({executable, movie, timeoutMs: 30_000, signal: abort.signal});
  process.stdout.write(JSON.stringify(operation === 'bundle-v1' ? bundleProbe(facts) : exportProbe(facts)) + '\n');
} catch {
  // Native stderr and private movie paths must not leak across this boundary.
  process.stderr.write('Record could not inspect the export movie\n');
  process.exitCode = 1;
}
