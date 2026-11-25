import {test, expect} from 'bun:test';
import {readFileSync, readdirSync} from 'node:fs';

const workflow = Bun.YAML.parse(readFileSync('.github/workflows/hermes.yml', 'utf8')) as any;
const verify = workflow.jobs.verify;
const step = (name: string) => {
  const found = verify.steps.filter((entry: any) => entry.name === name);
  expect(found).toHaveLength(1);
  return found[0];
};

test('Linux retains all source, package and bridge qualification', () => {
  // New source suites require classification before inheriting this exemption.
  expect(readdirSync('hermes/desktop').filter(name => name.endsWith('.test.ts')).sort())
    .toEqual(['controller.test.ts', 'plugin.test.ts']);
  expect(verify.strategy.matrix.os).toEqual(['ubuntu-24.04']);
  const source = step('Portable Hermes source contracts');
  expect(source.if).toBe("matrix.os == 'ubuntu-24.04'");
  expect(source.run).toBe('node --experimental-strip-types --test hermes/desktop/*.test.ts');
  const integration = step('Routing, bridge and package installation contracts');
  expect(integration.if).toBeUndefined();
  expect(integration.run).toBe('node --experimental-strip-types --test hermes/distribution/package.test.ts hermes/distribution/consumer.test.ts hermes/distribution/cache/*.test.ts composition/hermes/enablement/*.test.ts capture/agent/setup/hermes.test.ts capture/agent/setup/hermes-receiver.test.ts');
  expect(step('Package exact candidate without Rust or unrelated builds').if).toBeUndefined();
  const consumer = step('Verify Agent setup consumes the exact compiled archive');
  expect(consumer.if).toBeUndefined();
  expect(consumer.env.HERMES_PACKAGE).toBe('${{ steps.package.outputs.directory }}');
  expect(consumer.run).toBe('node --experimental-strip-types --test hermes/distribution/consumer.test.ts');
  expect(step('Install supported Hermes validator').if).toBeUndefined();
  expect(step('Validate installed package in an isolated profile').if).toBeUndefined();
});

test('publication requires clean isolation and Linux verification to succeed', () => {
  expect(workflow.jobs.contracts.steps.some((entry: any) =>
    entry.run === 'bun test enablement/ci/ hermes/verification/')).toBe(true);
  expect(verify.needs).toBe('contracts');
  expect(verify.if).toBe("needs.contracts.outputs.affected != 'false'");
  expect(verify['continue-on-error']).toBeUndefined();
  expect(verify.strategy['fail-fast']).toBe(false);
  expect(workflow.jobs.publish.needs).toEqual(['contracts', 'clean', 'verify']);
  expect(workflow.jobs.publish.if).toBe("needs.contracts.outputs.affected == 'true' && github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository == 'tryapparent/apparent'");
});

test('PR and main allocate only Linux and publication accepts Linux without Mac', () => {
  expect(Object.keys(workflow.on)).toEqual(['pull_request','push']);
  for (const job of Object.values(workflow.jobs) as any[]) {
    if (job.strategy?.matrix) expect(job.strategy.matrix.os).toEqual(['ubuntu-24.04']);
    else expect(job['runs-on']).toBe('ubuntu-24.04');
  }
  const publish = workflow.jobs.publish;
  const ready = (event: string, overrides: any = {}, repository = 'tryapparent/apparent', ref = 'refs/heads/main') => {
    const needs = {contracts: {result: 'success', outputs: {affected: 'true'}}, clean: {result: 'success'},
      verify: {result: 'success'}, ...overrides};
    return publish.needs.every((name: string) => needs[name].result === 'success') &&
      Function('needs','github',`return (${publish.if})`)(needs,{event_name: event,ref,repository});
  };
  expect(ready('push')).toBe(true);
  expect(ready('pull_request')).toBe(false);
  for (const name of publish.needs) for (const result of ['failure','cancelled','skipped'])
    expect(ready('push',{[name]: {result,outputs: {affected: 'true'}}})).toBe(false);
  expect(ready('push',{},'fork/apparent')).toBe(false);
  expect(ready('push',{},undefined,'refs/heads/other')).toBe(false);
  const artifact = verify.steps.find((entry: any) => entry.uses === 'actions/upload-artifact@v4');
  expect(artifact.if).toBe("matrix.os == 'ubuntu-24.04'");
  expect(artifact.with.name).toBe('hermes-${{ github.sha }}');
  expect(publish.steps[0].with.name).toBe(artifact.with.name);
  expect(publish.steps[1].run).toContain('sha256sum -c *.sha256');
  expect(publish.steps[1].run).toContain('--target "$SHA"');
});

test('validator phases use the Hermes owner entrypoint in the original order', () => {
  const names = [
    ['Prepare pinned Hermes validator and download identity', 'prepare'],
    ['Install supported Hermes validator', 'install'],
    ['Snapshot downloaded PyPI wheels only', 'snapshot'],
    ['Validate installed package in an isolated profile', 'validate'],
  ];
  let last = -1;
  for (const [name, mode] of names) {
    const current = step(name);
    expect(current.run).toBe('node --experimental-strip-types hermes/enablement/ci/validator-job.ts ' + mode);
    const index = verify.steps.indexOf(current);
    expect(index).toBeGreaterThan(last);
    last = index;
  }
  expect(step(names[2][0]).if).toBe("steps.validator-downloads.outputs.cache-hit != 'true'");
  expect(step(names[3][0]).if).toBeUndefined();
});
