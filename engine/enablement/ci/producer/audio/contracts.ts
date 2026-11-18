export type RenderAudio = (
  movie: string,
  streamIndexes: number[],
  maxSamples: number,
  extra?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<{ bytes: Buffer; sampleCount: number }>;
export type Hole = { start: number; end: number };
export type FixtureContext = {
  directory: string;
  probe: string;
  sources: Map<string, string>;
  digest: (file: string) => string;
  make: (file: string, args: string[]) => void;
  render: RenderAudio;
  rms: (bytes: Buffer, first: number, last: number) => number;
};
