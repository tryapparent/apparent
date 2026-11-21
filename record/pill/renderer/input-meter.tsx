import { useCallback, useId, useState, useSyncExternalStore } from "react";
import policy from "./soft-bloom.mjs";

export function InputMeter({
  input,
  receivedAt,
  reduced,
}: {
  input: readonly number[];
  receivedAt: number;
  reduced: boolean;
}) {
  const gradient = useId();
  const deadline = receivedAt + policy.freshness_ms();
  const subscribe = useCallback(
    (update: () => void) => {
      const delay = deadline - performance.now();
      if (delay <= 0) return () => {};
      const timer = setTimeout(update, Math.ceil(delay));
      return () => clearTimeout(timer);
    },
    [deadline],
  );
  const expired = useSyncExternalStore(
    subscribe,
    () => performance.now() >= deadline,
  );
  const [sample, setSample] = useState({
    input: null as readonly number[] | null,
    receivedAt,
    reading: policy.bloom(0, 0, false),
  });
  if (sample.input !== input || sample.receivedAt !== receivedAt) {
    const latest = input.at(-1);
    const valid =
      input.length === 24 &&
      latest !== undefined &&
      Number.isFinite(latest) &&
      latest >= 0 &&
      latest <= 1;
    const rms = valid ? Math.round(latest * 1000) : 0;
    setSample({
      input,
      receivedAt,
      reading: policy.bloom(sample.reading.level, rms, valid && !expired),
    });
  }

  const reading = expired
    ? policy.bloom(sample.reading.level, 0, false)
    : sample.reading;
  const level = reduced ? 0.62 : reading.level / 100;
  const label = !reading.fresh
    ? "Microphone level unavailable"
    : reading.active
      ? "Microphone input detected"
      : "Microphone listening, quiet";
  return (
    <span
      className="input-bloom"
      role="img"
      aria-label={label}
      data-reduced={reduced}
    >
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
        <defs>
          <radialGradient id={gradient}>
            <stop offset="34%" stopColor="currentColor" stopOpacity="0" />
            <stop
              offset="63%"
              stopColor="currentColor"
              stopOpacity={0.2 + 0.18 * level}
            />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.13" />
          </radialGradient>
        </defs>
        <circle
          className="input-bloom__ring"
          cx="22"
          cy="22"
          r={10.5 + 5.2 * level}
          fill={`url(#${gradient})`}
          stroke="currentColor"
          strokeWidth="1.3"
        />
        {reduced && reading.active && (
          <path
            d="M4 22h3 M37 22h3"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        )}
      </svg>
    </span>
  );
}
