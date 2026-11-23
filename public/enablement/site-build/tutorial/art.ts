export const BG_DARK = "#0b0c0f";
export const SURFACE = "#14161b";
export const CARD_BG = "#191c23";
export const PILL_BG = "#141416";
export const LINE_SUBTLE = "#272b35";
export const TEXT_WHITE = "#f4f5f8";
export const TEXT_SOFT = "#c6cad4";
export const TEXT_MUTED = "#828897";
export const ACCENT_RED = "#ff3b30";
export const ACCENT_BLUE = "#4b73ff";
export const ACCENT_GREEN = "#5cd696";

export const FONT_SANS = "DM Sans";
export const FONT_DISPLAY = "Inter 24pt";
export const FONT_MONO = "JetBrains Mono";

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function smoothstep(start: number, end: number, time: number): number {
  const t = clamp((time - start) / (end - start));
  return t * t * (3 - 2 * t);
}

export function smootherstep(start: number, end: number, time: number): number {
  const t = clamp((time - start) / (end - start));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function spring(
  time: number,
  stiffness: number,
  damping: number,
): number {
  const decay = damping / 2;
  const frequency = Math.sqrt(stiffness - decay * decay);
  const t = Math.max(time, 0);
  return (
    1 -
    Math.exp(-t * decay) *
      (Math.cos(t * frequency) + (decay / frequency) * Math.sin(t * frequency))
  );
}

export function easeOut(value: number): number {
  const x = clamp(value);
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step++) {
    const t = (low + high) / 2;
    const curveX = 3 * 0.58 * (1 - t) * t * t + t * t * t;
    if (curveX < x) low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  return t * t * (3 - 2 * t);
}

export function keycap(
  x: number,
  y: number,
  width: number,
  label: string,
  pressed: number,
): string {
  const offset = pressed * 4;
  const border = pressed > 0.5 ? "#ff6b63" : "#363b47";
  const fill = pressed > 0.5 ? "#2b191b" : "#1a1d24";
  return `
    <g>
      <rect x="${x}" y="${y + 6}" width="${width}" height="64" rx="14" fill="#08090c" />
      <rect x="${x}" y="${y + offset}" width="${width}" height="64" rx="14" fill="${fill}" stroke="${border}" stroke-width="2" />
      <text x="${x + width / 2}" y="${y + offset + 42}" text-anchor="middle" font-family="'${FONT_MONO}'" font-weight="400" font-size="28" fill="${TEXT_WHITE}">${label}</text>
    </g>
  `;
}

export function shortcut(
  letter: "S" | "V",
  y: number,
  pressed: number,
): string {
  return [
    keycap(690, y, 88, "⌃", pressed),
    keycap(792, y, 88, "⌥", pressed),
    keycap(894, y, 88, "⇧", pressed),
    keycap(996, y, 134, letter, pressed),
  ].join("");
}
