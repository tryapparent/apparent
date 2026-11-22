import {
  ACCENT_BLUE,
  ACCENT_RED,
  CARD_BG,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_SANS,
  LINE_SUBTLE,
  PILL_BG,
  SURFACE,
  TEXT_SOFT,
  TEXT_WHITE,
  clamp,
  keycap,
  smootherstep,
  smoothstep,
} from "./art.ts";

export function draw(t: number): string {
  const opacity = smoothstep(0, 0.25, t) * (1 - smoothstep(5.05, 5.38, t));
  const clickAge = Math.max(t - 0.8, 0);
  const rippleOpacity = t >= 0.8 ? clamp(1 - clickAge) : 0;
  const rippleRadius = 12 + 36 * smoothstep(0, 0.8, clickAge);
  const shiftHeld = clamp(
    smoothstep(1.5, 1.65, t) * (1 - smoothstep(3.8, 4, t)),
  );
  const strokeFade = 1 - smoothstep(4.2, 4.85, t);
  const dashLength = 920;
  const dashOffset = dashLength * (1 - smootherstep(1.65, 3.3, t));
  const bars = Array.from({ length: 28 }, (_, index) => {
    const phase = t * 8.5 + index * 0.55;
    const amplitude = clamp(
      Math.abs(Math.sin(phase)) * 0.65 +
        Math.abs(Math.cos(phase * 0.47)) * 0.35,
      0.15,
    );
    const height = 8 + 34 * amplitude;
    return `<rect x="${340 + index * 16}" y="${920 - height * 0.5}" width="8" height="${height}" rx="4" fill="${ACCENT_RED}" />`;
  }).join("");
  const pulse = 0.65 + 0.35 * Math.sin(t * 4.5);

  return `
  <g opacity="${opacity}">
      <text x="160" y="102" font-family="'${FONT_MONO}'" font-weight="400" font-size="28" fill="${ACCENT_RED}">
          STEP 02 · SPEAK, CLICK &amp; HOLD SHIFT TO DRAW
      </text>
      <text x="160" y="158" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="52" fill="${TEXT_WHITE}">
          2 · Hold Shift and Move to Draw Red Strokes
      </text>

      <rect x="1380" y="68" width="380" height="54" rx="27" fill="${PILL_BG}" stroke="#343844" stroke-width="1.5" />
      <circle cx="1414" cy="95" r="14" fill="${ACCENT_RED}" fill-opacity="${0.28 * pulse}" />
      <circle cx="1414" cy="95" r="6.5" fill="${ACCENT_RED}" />
      <text x="1465" y="102" text-anchor="middle" font-family="'${FONT_MONO}'" font-weight="400" font-size="22" fill="${TEXT_WHITE}">
          0:0${Math.floor(t)}
      </text>
      <rect x="1512" y="83" width="1.5" height="24" fill="#2e323d" />
      <text x="1566" y="101" text-anchor="middle" font-family="'${FONT_SANS}'" font-weight="500" font-size="20" fill="${TEXT_SOFT}">Cancel</text>
      <rect x="1632" y="76" width="116" height="38" rx="19" fill="${ACCENT_BLUE}" />
      <text x="1690" y="101" text-anchor="middle" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="20" fill="${TEXT_WHITE}">Finish</text>

      <rect x="160" y="200" width="1600" height="630" rx="22" fill="${SURFACE}" stroke="#ffffff38" stroke-width="2" />

      <rect x="240" y="265" width="680" height="78" rx="14" fill="#232732" />
      <text x="280" y="314" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="30" fill="${TEXT_WHITE}">DESKTOP</text>

      <rect x="240" y="385" width="680" height="78" rx="14" fill="#1c2029" />
      <text x="280" y="434" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="30" fill="${TEXT_SOFT}">SLACKBOT</text>

      <rect x="240" y="525" width="680" height="78" rx="14" fill="#1c2029" />
      <text x="280" y="574" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="30" fill="${TEXT_SOFT}">BLOG GAME</text>

      <rect x="240" y="645" width="680" height="78" rx="14" fill="#1c2029" />
      <text x="280" y="694" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="30" fill="${TEXT_SOFT}">APPARENT</text>

      <rect x="1020" y="265" width="660" height="458" rx="18" fill="${CARD_BG}" stroke="${LINE_SUBTLE}" stroke-width="1.5" />
      <text x="1064" y="332" font-family="'${FONT_MONO}'" font-weight="400" font-size="24" fill="${ACCENT_RED}">LIVE TELEMETRY</text>
      <text x="1064" y="392" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="34" fill="${TEXT_WHITE}">• Clicks coalesce on final burst</text>
      <text x="1064" y="452" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="34" fill="${TEXT_WHITE}">• Shift + move draws 4.5px red ink</text>
      <text x="1064" y="512" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="34" fill="${TEXT_WHITE}">• Fades 650ms after releasing Shift</text>
      <text x="1064" y="572" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="34" fill="${TEXT_WHITE}">• Words align to action [t0..t1]</text>

      <g opacity="${rippleOpacity}">
          <circle cx="560" cy="492" r="${rippleRadius}" fill="#0088ff" fill-opacity="0.28" stroke="#ffffff" stroke-width="3" />
          <circle cx="560" cy="492" r="${Math.max(rippleRadius + 5.0, 1.0)}" fill="none" stroke="#0088ff" stroke-width="2.5" />
      </g>

      <g opacity="${strokeFade}">
          <path d="M 380 488 C 460 456, 740 456, 790 492 C 835 524, 730 548, 560 544 C 410 540, 345 512, 410 482"
              fill="none"
              stroke="${ACCENT_RED}"
              stroke-width="6"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-dasharray="${dashLength}"
              stroke-dashoffset="${dashOffset}" />
      </g>

      <rect x="160" y="882" width="1290" height="76" rx="18" fill="${CARD_BG}" stroke="${LINE_SUBTLE}" stroke-width="1.5" />
      <text x="196" y="929" font-family="'${FONT_MONO}'" font-weight="400" font-size="24" fill="${ACCENT_RED}">MIC</text>
      ${bars}
      <text x="805" y="928" font-family="'${FONT_SANS}'" font-weight="500" font-size="25" fill="${TEXT_WHITE}">
          “There's a dead space between these session tabs…”
      </text>
      ${keycap(1480.0, 888.0, 280.0, "⇧ Hold to Draw", shiftHeld)}
  </g>
  `;
}
