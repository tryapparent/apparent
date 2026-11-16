// Preserve existing consumers and gate identities in the central router. These
// facts describe Agent inputs, not an independent selection/range algorithm.
export function agentConsumers(path: string): readonly ('capture' | 'engine' | 'capture-tools' | 'hermes' | 'desktop')[] | undefined {
  if (path.startsWith('capture/agent/setup/') || path.startsWith('capture/agent/enablement/setup/')) return ['capture', 'engine', 'hermes'];
  if (['capture/agent/enablement/checks.ts', 'capture/agent/enablement/dependencies.ts', 'capture/agent/enablement/package.json'].includes(path)) return ['capture', 'engine', 'capture-tools', 'hermes'];
  if (path.startsWith('capture/agent/enablement/scripts/')) return ['capture', 'engine', 'capture-tools'];
  if (path === 'capture/agent/enablement/media/build.ts') return ['desktop', 'capture'];
  if (path.startsWith('capture/agent/enablement/media/')) return ['capture', 'engine'];
}
