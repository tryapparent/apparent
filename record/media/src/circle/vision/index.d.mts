export function recognize(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<{ index: number; label: string; score: number }[]>;
