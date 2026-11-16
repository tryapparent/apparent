// Connect facts consumed by the single repository routing authority. No selector
// runs here: shared/native inputs and unknown-path fallback remain central.
import type {Owner} from '../../../enablement/ci/routing/consumers.ts';
export const connectStreamInputs = ['!.github/workflows/hermes.yml', '!.github/workflows/stream-public.yml',
  'connect/**', 'public/site/**', '.github/workflows/stream-connect.yml', 'enablement/release_gate.py'];
export function connectConsumers(path: string, native: boolean): readonly Owner[] | null {
  if (path === 'public/site/scripts/browser-proof/test-hosted-browser.mjs') return ['public', 'web'];
  if (path === '.github/workflows/stream-connect.yml' || path.startsWith('connect/enablement/ci/'))
    return ['capture', 'client', 'client-foreground', 'web', 'service'];
  if (!native && (path.startsWith('connect/web/') || path.startsWith('connect/enablement/web/') ||
      path.startsWith('connect/enablement/verification/web/'))) return ['web'];
  if (['connect/client/typescript/src/mcp-wire.ts', 'connect/client/typescript/src/transfer/contract.ts',
      'connect/client/typescript/contracts.ts'].includes(path)) return ['client', 'capture', 'service'];
  if (path.startsWith('connect/client/') || path.startsWith('connect/enablement/client/') ||
      path.startsWith('connect/enablement/verification/client/')) return ['client', 'capture'];
  if (!native && (path.startsWith('connect/service/') || path.startsWith('connect/enablement/service/') ||
      path.startsWith('connect/enablement/verification/service/'))) return ['service', 'client', 'web', 'capture'];
  if (path.startsWith('connect/')) return ['capture', 'client', 'web', 'service'];
  return null;
}

export const connectPublicAssets = new Set(['hosted/source-pond-v4.png', 'hosted/agent-pond-v4.png',
  'hosted/agent-reading-v4.png', 'fonts/HostGrotesk-Variable.ttf', 'brand/apparent-wordmark.svg']
  .map(path => 'public/site/public/assets/' + path));
