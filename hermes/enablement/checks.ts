// Hermes owns these command definitions; repository admission only selects owners.
// Paths are repository-relative so both hosted and local callers use real inputs.
export type Command = {argv: string[]; cwd: string};
const node = ['node', '--experimental-strip-types'];
export const sourceTests = ['hermes/desktop/controller.test.ts', 'hermes/desktop/plugin.test.ts'];
export const packageTests = ['hermes/enablement/distribution/package.test.ts'];
export const consumerTests = ['hermes/enablement/distribution/consumer.test.ts'];
export const integrationTests = [...packageTests, ...consumerTests, 'hermes/distribution/cache/downloads.test.ts',
  'capture/agent/setup/hermes.test.ts', 'capture/agent/setup/hermes-receiver.test.ts',
  'capture/desktop/ui/frontend/src/hermes/protocol.test.ts', 'capture/desktop/ui/frontend/src/hermes/mailbox.test.ts'];
export function testCommand(files: string[]): Command {
  return {argv: [...node, '--test', ...files], cwd: '.'};
}
export function localCommands(): Command[] {
  return [
    {argv: ['npm', 'ci', '--ignore-scripts', '--prefix', 'hermes/enablement'], cwd: '.'},
    {argv: ['python3', '-m', 'unittest', 'discover', '-s', 'hermes/tests', '-p', 'test_*.py'], cwd: '.'},
    testCommand([...sourceTests, ...integrationTests]),
  ];
}
