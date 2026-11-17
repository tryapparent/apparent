// Record owns trial admission and the public live-text projection. Native owns
// PCM durability, inference, timing and complete-recording recovery.
export type Facts = {enabled: boolean; platform: string};
export function admission(value: unknown): {version: 1; streaming: boolean} {
  if (!value || typeof value !== 'object') throw Error('Missing transcription facts');
  const facts = value as Record<string, unknown>;
  if (typeof facts.enabled !== 'boolean' || typeof facts.platform !== 'string') throw Error('Invalid transcription facts');
  return {version: 1, streaming: facts.enabled && ['linux', 'macos'].includes(facts.platform)};
}
export type Preview = {state: 'starting' | 'streaming' | 'failed'; text: string};
export function preview(value: Preview | null | undefined, recording: boolean): {text: string; failed: boolean} | null {
  if (!recording || !value) return null;
  // Bound the presentation independently from the full timed transcript. Keep
  // the newest words; the full transcript remains the native bundle's output.
  const text = Array.from(value.text.replace(/\s+/gu, ' ').trim()).slice(-1024).join('');
  return {text, failed: value.state === 'failed'};
}
