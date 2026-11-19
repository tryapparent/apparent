export function openPill(): {
  dispatchNative(input: string, now: number, motionNow?: number): string;
  presentNative(input: string): string;
};
