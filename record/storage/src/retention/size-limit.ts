import capacity, {type Bytes} from './capacity.mjs';

export function storageLimitValid(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff && capacity.constrain(value);
}

export function parseStorageLimit(input: string): number | undefined {
  const match = /^(\d{1,5})(?:\.(\d{1,3}))?$/.exec(input);
  if (!match) return undefined;
  const megabytes = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
  return storageLimitValid(megabytes) ? megabytes : undefined;
}

export function storageLimitWarn(saved: number | null, next: number): boolean {
  return capacity.warn(saved !== null, saved ?? 0, next);
}

function bytes(value: bigint): Bytes {
  return {$:'Bytes', hi:Number(value >> 32n), lo:Number(value & 0xffffffffn)};
}

export function selectCapacityCaptures(
  maximumMb: number, total: bigint, observations: readonly {ageMs: bigint; unchangedMs: bigint; size: bigint}[],
): Set<number> {
  const selected = new Set<number>();
  if (maximumMb === 0) return selected;
  const limit = bytes(BigInt(maximumMb) * 1_000_000n);
  let remaining = bytes(total);
  const ordered = observations.map((facts, index) => ({...facts, index, age:bytes(facts.ageMs)}));
  ordered.sort((left, right) => capacity.below(left.age, right.age) ? 1 : capacity.below(right.age, left.age) ? -1 : 0);
  for (const row of ordered) {
    const decision = capacity.choose(remaining, limit, row.age, bytes(row.unchangedMs), bytes(row.size));
    if (decision.trash) selected.add(row.index);
    remaining = decision.remaining;
  }
  return selected;
}
