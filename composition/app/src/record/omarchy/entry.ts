import { launchNativeHost } from './native-host.ts';
import { createRecordHostServices as createHost } from './host.ts';
import { recordShutdownEvent } from './shutdown-diagnostic.ts';

/** Trusted package entry. The existing native GUI supplies OS effects only;
 * Record and Engine retain all recording/output authority. */
export async function createRecordHostServices(input: { profilePath: string; nativeRoot: string }) {
  const native = await launchNativeHost(input.profilePath, input.nativeRoot);
  try {
    const host = await createHost(input);
    return { ...host, async close() {
      await host.close(); recordShutdownEvent('native-host-close-start');
      await native.close(); recordShutdownEvent('native-host-close-complete');
    } };
  } catch (error) {
    // Keep partial handles for exact-owner reconciliation; setup failure is not
    // permission to end an owning capture connection or discard unknown work.
    throw new AggregateError([error], 'Desktop setup incomplete; ownership retained', { cause: { native } });
  }
}
