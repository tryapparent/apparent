import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createConfigBackend, type ConfigBackend } from '@apparent/config-host';
import { adoptOnboardingProgress, onboardingProgressCodec } from '@apparent/onboarding';
import type { JsonValue, ProgressStore } from '@apparent/app-contracts/host';
import { bindOwnerProgress } from '../host-services.ts';

/** Same reviewed config producer already staged for the normal Record host.
 * Compatibility is explicit: a future helper must be admitted before adoption. */
const configDigest = 'b1a89cae8351770eb42bc1876ab9718fe336e618ab238a387c00c48f11eef5d5';

export async function bindOnboardingWriter(backend: ConfigBackend, verifyLegacyWriter: () => Promise<void>) {
  // This is the actual owned native writer/producer check, not profile isolation
  // or a caller assertion that the helper's retirement marker is sufficient.
  await verifyLegacyWriter();
  const adopted = await adoptOnboardingProgress(backend);
  if (adopted.status !== 'ready') throw new Error('Onboarding adoption requires reconciliation');
  const retired = await backend.retireOnboardingLegacyWriter();
  if (retired.status !== 'retired') throw new Error('Onboarding writer retirement is unknown');
  await verifyLegacyWriter();
  const store = bindOwnerProgress(backend, 'onboarding', onboardingProgressCodec);
  const wire: ProgressStore<unknown> = {
    async read() { const value = await store.read(); return { ...value, value: onboardingProgressCodec.encode(value.value) }; },
    async compareAndSwap(expected, value) {
      const result = await store.compareAndSwap(expected, onboardingProgressCodec.decode(value as JsonValue));
      return result.status === 'conflict' ? { ...result, current: onboardingProgressCodec.encode(result.current) } : result;
    },
  };
  return wire;
}

export async function createOmarchyOnboardingProgress(input: {
  profilePath: string; nativeRoot: string; verifyLegacyWriter(): Promise<void>;
}) {
  await input.verifyLegacyWriter();
  const directory = join(input.nativeRoot, 'config');
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.schema !== 1 || manifest.protocol !== 1 || manifest.sha256 !== configDigest) {
    throw new Error('Onboarding config producer has not been admitted for writer adoption');
  }
  const backend = await createConfigBackend({ executable: join(directory, 'apparent-config-host'),
    executableSha256: configDigest, configPath: join(input.profilePath, 'home/.config/apparent/config.json'), ownerId: 'onboarding' });
  try {
    const store = await bindOnboardingWriter(backend, input.verifyLegacyWriter);
    return { store, close: () => backend.close() };
  } catch (error) {
    // Closing this config transport never releases or cancels native Record work.
    try { await backend.close(); } catch (closeError) { throw new AggregateError([error, closeError], 'Onboarding config ownership unresolved', { cause: { backend } }); }
    throw error;
  }
}
