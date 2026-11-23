import type { Word } from "../recognition.ts";
export function recognize(
  rgba: Uint8Array,
  width: number,
  height: number,
  mode: "auto" | "line",
): Promise<Word[]>;
