import type { CommandResult, RecordCommand } from '@apparent/record/capabilities';
import { cloneJsonDto } from '../wire.ts';
export interface MicrophoneReadiness { support: 'available' | 'unavailable' }
export type MicrophoneStart = Extract<RecordCommand, { type: 'start-capture' }>;
export interface MicrophoneRendererPort {
  read(): Promise<MicrophoneReadiness>;
  start(command: MicrophoneStart): Promise<CommandResult>;
}
export const MICROPHONE_CHANNELS = Object.freeze({
  read: 'apparent:record:microphone:read', start: 'apparent:record:microphone:start',
});
export function microphoneReadiness(value: unknown): MicrophoneReadiness | undefined {
  const dto = cloneJsonDto(value);
  if (!dto || typeof dto !== 'object' || Array.isArray(dto)
    || Object.keys(dto).length !== 1 || !Object.hasOwn(dto, 'support')) return undefined;
  const support = (dto as { support: unknown }).support;
  return support === 'available' || support === 'unavailable' ? { support } : undefined;
}
