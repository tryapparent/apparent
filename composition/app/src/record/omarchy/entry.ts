import { launchNativeHost } from './native-host.ts';
import { createRecordHostServices as createHost } from './host.ts';

/** Trusted package entry. The existing native GUI supplies OS effects only;
 * Record and Engine retain all recording/output authority. */
export async function createRecordHostServices(input: { profilePath: string; nativeRoot: string }) {
  const native = await launchNativeHost(input.profilePath, input.nativeRoot);
  try {
    const host = await createHost(input);
    return { ...host, async close() { await host.close(); await native.close(); } };
  } catch (error) {
    // Keep partial handles for exact-owner reconciliation; setup failure is not
    // permission to end an owning capture connection or discard unknown work.
    throw new AggregateError([error], 'Desktop setup incomplete; ownership retained', { cause: { native } });
  }
}
