import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

/** Same native/TS contract consumer for Vite packaging and Rust provider jobs. */
export async function buildOnboardingPolicy(): Promise<void> {
  await build({
    entryPoints: { 'onboarding-workflow': fileURLToPath(new URL('../../../../../onboarding/src/host.ts', import.meta.url)) },
    bundle: true, platform: 'node', format: 'cjs',
    outdir: fileURLToPath(new URL('../dist/assets', import.meta.url)),
    outExtension: { '.js': '.cjs' },
  });
}
