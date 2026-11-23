import {
  TEXT_WHITE,
  TEXT_SOFT,
  TEXT_MUTED,
  FONT_DISPLAY,
  FONT_SANS,
  PILL_BG,
  FONT_MONO,
  shortcut,
  smoothstep,
  clamp,
  spring,
  easeOut,
} from "./art.ts";

export function intro(t: number): string {
  const exitOpacity = 1 - smoothstep(4, 4.38, t);
  const press = clamp(
    smoothstep(1.4, 1.6, t) * (1 - smoothstep(1.85, 2.05, t)),
  );
  const pillScale = 0.55 + 0.45 * spring(t - 1.55, 240, 19);
  const pillOpacity = smoothstep(1.55, 1.78, t);
  const pillX = 960 * (1 - pillScale);
  const pillY = 76 * (1 - pillScale);
  const iconY = 32 * (1 - spring(t, 180, 18));
  const iconOpacity = 0.28 + 0.72 * easeOut(t / 0.65);
  const titleY = 28 * (1 - spring(t - 0.05, 180, 20));
  const titleOpacity = 0.35 + 0.65 * easeOut(t / 0.55);

  return `
  <g opacity="${exitOpacity}">
      <g opacity="${pillOpacity}" transform="translate(${pillX} ${pillY}) scale(${pillScale})">
          <rect x="770" y="52" width="380" height="52" rx="26" fill="${PILL_BG}" stroke="#343844" stroke-width="1.5" />
          <rect x="780" y="60" width="96" height="36" rx="18" fill="#ffffff" fill-opacity="0.16" />
          <text x="828" y="84" text-anchor="middle" font-family="'${FONT_SANS}'" font-weight="500" font-size="20" fill="${TEXT_WHITE}">Area</text>
          <text x="955" y="84" text-anchor="middle" font-family="'${FONT_SANS}'" font-weight="500" font-size="20" fill="${TEXT_SOFT}">Full Screen</text>
          <rect x="1038" y="66" width="1.5" height="24" fill="#2e323d" />
          <text x="1092" y="85" text-anchor="middle" font-family="'${FONT_MONO}'" font-weight="400" font-size="20" fill="${TEXT_MUTED}">x</text>
      </g>

      <g transform="translate(0 ${iconY})"
      opacity="${iconOpacity}">
          <use href="#app-icon" x="820" y="170" width="280" height="280" />
      </g>

      <g transform="translate(0 ${titleY})"
      opacity="${titleOpacity}">
          <text x="960" y="545" text-anchor="middle" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="104" letter-spacing="-2" fill="${TEXT_WHITE}">
              Apparent
          </text>
          <text x="960" y="622" text-anchor="middle" font-family="'${FONT_SANS}'" font-weight="500" font-size="42" fill="${TEXT_SOFT}">
              Screen, voice, and freehand ink for coding agents
          </text>
      </g>

      <g opacity="${smoothstep(0.45, 0.85, t)}">
          <text x="960" y="785" text-anchor="middle" font-family="'${FONT_MONO}'" font-weight="400" font-size="28" fill="${TEXT_MUTED}">
              PRESS SHORTCUT ANYWHERE TO START
          </text>
          ${shortcut("S", 825, press)}
      </g>
  </g>
  `;
}
