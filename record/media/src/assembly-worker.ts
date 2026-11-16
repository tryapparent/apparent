import {assemblyPlan} from './assembly-policy.ts';

// A single finite policy request, with no provider, GUI or persistence access.
try {
  const [duration, ...extra] = process.argv.slice(2);
  if (!duration || extra.length || !/^(0|[1-9][0-9]{0,19})$/.test(duration)) throw Error('Invalid request');
  process.stdout.write(JSON.stringify(assemblyPlan(BigInt(duration))) + '\n');
} catch {
  process.stderr.write('Record could not plan bundle assembly\n');
  process.exitCode = 1;
}
