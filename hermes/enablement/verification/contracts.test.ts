import {test, expect} from 'bun:test';
import {readFileSync, readdirSync} from 'node:fs';
import {sourceTests, integrationTests, consumerTests} from '../checks.ts';

const workflow = Bun.YAML.parse(readFileSync('.github/workflows/hermes.yml', 'utf8')) as any;
const verify = workflow.jobs.verify;
const step = (name: string) => {
  const found = verify.steps.filter((entry: any) => entry.name === name);
  expect(found).toHaveLength(1);
  return found[0];
};

test('only the audited source group moves to Linux; package and bridge qualification stays on both OSes', () => {
  // New source suites require classification before inheriting this exemption.
  expect(readdirSync('hermes/desktop').filter(name => name.endsWith('.test.ts')).sort())
    .toEqual(['controller.test.ts', 'plugin.test.ts']);
  expect(verify.strategy.matrix.os).toEqual(['ubuntu-24.04', 'macos-15-intel']);
  const source = step('Portable Hermes source contracts');
  expect(source.if).toBe("matrix.os == 'ubuntu-24.04'");
  expect(source.run).toBe('node --experimental-strip-types hermes/enablement/check.ts source');
  const integration = step('Routing, bridge and package installation contracts');
  expect(integration.if).toBeUndefined();
  expect(integration.run).toBe('node --experimental-strip-types hermes/enablement/check.ts integration');
  expect(step('Package exact candidate without Rust or unrelated builds').if).toBeUndefined();
  const consumer = step('Verify Agent setup consumes the exact compiled archive');
  expect(consumer.if).toBeUndefined();
  expect(consumer.env.HERMES_PACKAGE).toBe('${{ steps.package.outputs.directory }}');
  expect(consumer.run).toBe('node --experimental-strip-types hermes/enablement/check.ts consumer');
  expect(step('Install supported Hermes validator').if).toBeUndefined();
  expect(step('Validate installed package in an isolated profile').if).toBeUndefined();
});

test('publication still requires clean isolation and the entire native matrix to succeed', () => {
  expect(workflow.jobs.contracts.steps.some((entry: any) =>
    entry.run === 'bun test enablement/ci/ hermes/enablement/verification/')).toBe(true);
  expect(verify.needs).toBe('contracts');
  expect(verify.if).toBe("needs.contracts.outputs.affected != 'false'");
  expect(verify['continue-on-error']).toBeUndefined();
  expect(verify.strategy['fail-fast']).toBe(false);
  expect(workflow.jobs.publish.needs).toEqual(['contracts', 'clean', 'verify']);
  expect(workflow.jobs.publish.if).toBe("needs.contracts.outputs.affected == 'true' && github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository == 'tryapparent/apparent'");
});

test('finite owner inventory preserves every portable and bridge suite', () => {
  expect(sourceTests).toEqual(readdirSync('hermes/desktop').filter(n => n.endsWith('.test.ts')).sort().map(n => 'hermes/desktop/' + n));
  for (const directory of ['hermes/distribution/cache', 'capture/desktop/ui/frontend/src/hermes']) {
    for (const name of readdirSync(directory).filter(n => n.endsWith('.test.ts')))
      expect(integrationTests).toContain(directory + '/' + name);
  }
  expect(integrationTests).toContain('capture/agent/setup/hermes.test.ts');
  expect(integrationTests).toContain('capture/agent/setup/hermes-receiver.test.ts');
  expect(consumerTests).toEqual(['hermes/enablement/distribution/consumer.test.ts']);
});
