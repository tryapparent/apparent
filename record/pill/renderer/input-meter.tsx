import { useCallback, useSyncExternalStore } from "react";
import { waveformLevels, waveformHeight } from "./meter-policy";

export function InputMeter({
  input,
  receivedAt,
  reduced,
}: {
  input: readonly number[];
  receivedAt: number;
  reduced: boolean;
}) {
  const subscribe = useCallback(
    (update: () => void) => {
      const remaining = receivedAt + 310 - performance.now();
      if (remaining <= 0) return () => {};
      const timer = setTimeout(update, remaining);
      return () => clearTimeout(timer);
    },
    [receivedAt],
  );
  const expired = useSyncExternalStore(
    subscribe,
    () => performance.now() - receivedAt >= 300,
  );
  const levels = waveformLevels(
    input,
    receivedAt,
    receivedAt + (expired ? 300 : 0),
  );
  const latest = levels.at(-1) ?? 0;
  return (
    <span
      className="meter"
      role="img"
      aria-label="Captured microphone waveform"
      data-active={latest > Math.pow(0.002, 0.55) * 1.15}
      data-reduced={reduced}
    >
      {levels.map((level, index) => (
        <i
          aria-hidden="true"
          key={index}
          style={{
            height: `${waveformHeight(level, reduced)}px`,
            opacity: 0.35 + (0.65 * index) / 23,
          }}
        />
      ))}
    </span>
  );
}
