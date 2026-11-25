import type {LocationPorts, RetentionPorts} from '@apparent/record-storage';

import {bindPreference} from '../../../../../../shared/settings/binding';
export const locationPorts: LocationPorts = {
  read: async () => await window.apparent?.readCaptureLocation() ?? {status: 'disabled'},
  change: bindPreference('storage', 'storage.capturesDir', async () => await window.apparent?.changeCaptureLocation() ?? {status: 'disabled' as const}),
  reset: bindPreference('storage', 'storage.capturesDir', async () => await window.apparent?.resetCaptureLocation() ?? {status: 'disabled' as const}),
  show: async () => { await window.apparent?.showCaptureFolder(); },
};
export const retentionPorts: RetentionPorts = {
  read: async () => await window.apparent?.readRetention() ?? {status: 'disabled'},
  save: bindPreference('storage', 'storage.mediaDays', bindPreference('storage', 'storage.bundleDays', async policy => await window.apparent?.saveRetention(policy) ?? {status: 'disabled' as const})),
  reset: bindPreference('storage', 'storage.mediaDays', bindPreference('storage', 'storage.bundleDays', async () => await window.apparent?.resetRetention() ?? {status: 'disabled' as const})),
  usage: async () => await window.apparent?.readCaptureUsage() ?? {status: 'disabled'},
};

export const sizeLimitPorts = {
  read: retentionPorts.read,
  usage: retentionPorts.usage,
  save: bindPreference('storage', 'storage.maximumMb', async (maximumMb: number) => await window.apparent?.saveStorageLimit?.(maximumMb) ?? {status: 'disabled' as const}),
};
