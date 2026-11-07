import { createConfigBackend } from './client.ts';
import type { ConnectCloudConfig } from '@apparent/app-contracts/native';
export { MAX_CONNECT_CLOUD_VALUE_BYTES } from '@apparent/app-contracts/native';
export type { ConnectCloudConfig, LegacyConfigValue } from '@apparent/app-contracts/native';

/** Trusted composition supplies an admitted helper and shared config location. */
export interface ConnectCloudConfigOptions {
  executable: string;
  executableSha256: string;
  configPath: string;
  timeoutMs?: number;
}

/** Opaque fixed-group CAS. No policy, arbitrary key selector or Node config writer. */
export async function createConnectCloudConfig(options: ConnectCloudConfigOptions): Promise<ConnectCloudConfig & { close(): Promise<void> }> {
  const backend = await createConfigBackend({ ...options, ownerId: 'connect' });
  return {
    read: () => backend.readConnectCloud(),
    compareAndSwap: (expected, next) => backend.compareAndSwapConnectCloud(expected, next),
    close: () => backend.close(),
  };
}
