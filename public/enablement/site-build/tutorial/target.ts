import {
  ACCENT_BLUE,
  ACCENT_GREEN,
  ACCENT_RED,
  CARD_BG,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_SANS,
  LINE_SUBTLE,
  PILL_BG,
  SURFACE,
  TEXT_MUTED,
  TEXT_SOFT,
  TEXT_WHITE,
  clamp,
  keycap,
  smootherstep,
  smoothstep,
} from "./art.ts";

export function target(t: number): string {
  const opacity = smoothstep(0, 0.25, t) * (1 - smoothstep(4.65, 4.98, t));
  const windowMode = t >= 2.35;
  const drag = smootherstep(0.35, 1.65, t);
  const glide = smootherstep(2.35, 2.85, t);
  const x = 420 + 400 * glide;
  const y = 270 - 40 * glide;
  const width = windowMode ? 660 + 120 * glide : 40 + 620 * drag;
  const height = windowMode ? 460 + 80 * glide : 30 + 430 * drag;
  const radius = windowMode ? 16 : 3;
  const stroke = windowMode ? ACCENT_BLUE : TEXT_WHITE;
  const title = windowMode
    ? "1 · Hit Space for Camera Window Picker"
    : "1 · Drag an Area or Hit Space for Window";
  const label = windowMode
    ? "OpenCode - Composer"
    : `${Math.round(width)} x ${Math.round(height)}`;
  const cameraX = x + width * 0.68;
  const cameraY = y + height * 0.72;
  const spacePress = clamp(
    smoothstep(2.2, 2.35, t) * (1 - smoothstep(2.6, 2.8, t)),
  );

  return `
  <g opacity="${opacity}">
      <text x="160" y="102" font-family="'${FONT_MONO}'" font-weight="400" font-size="28" fill="${ACCENT_RED}">
          STEP 01 · TARGET SELECTION
      </text>
      <text x="160" y="158" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="52" fill="${TEXT_WHITE}">
          ${title}
      </text>

      <rect x="1360" y="68" width="400" height="54" rx="27" fill="${PILL_BG}" stroke="#343844" stroke-width="1.5" />
      <rect x="1370" y="76" width="102" height="38" rx="19" fill="#ffffff" fill-opacity="${windowMode ? 0 : 0.18}" />
      <text x="1421" y="101" text-anchor="middle" font-family="'${FONT_SANS}'" font-weight="500" font-size="20" fill="${TEXT_WHITE}">Area</text>
      <text x="1555" y="101" text-anchor="middle" font-family="'${FONT_SANS}'" font-weight="500" font-size="20" fill="${TEXT_SOFT}">Full Screen</text>
      <rect x="1648" y="83" width="1.5" height="24" fill="#2e323d" />
      <text x="1704" y="102" text-anchor="middle" font-family="'${FONT_MONO}'" font-weight="400" font-size="20" fill="${TEXT_MUTED}">x</text>

      <rect x="160" y="200" width="1600" height="630" rx="22" fill="${SURFACE}" stroke="${LINE_SUBTLE}" stroke-width="2" />

      <rect x="210" y="230" width="560" height="540" rx="14" fill="${CARD_BG}" stroke="#2a2f3a" stroke-width="1.5" />
      <text x="246" y="282" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="28" fill="${TEXT_SOFT}">Sessions</text>
      <rect x="236" y="310" width="508" height="54" rx="10" fill="#232730" />
      <text x="260" y="345" font-family="'${FONT_MONO}'" font-weight="400" font-size="24" fill="${TEXT_WHITE}">DESKTOP · opencode</text>
      <text x="260" y="415" font-family="'${FONT_MONO}'" font-weight="400" font-size="24" fill="${TEXT_MUTED}">APPARENT · rust + gpui</text>
      <text x="260" y="475" font-family="'${FONT_MONO}'" font-weight="400" font-size="24" fill="${TEXT_MUTED}"> IOS BUILD SCALE</text>

      <rect x="820" y="230" width="780" height="540" rx="16" fill="${CARD_BG}" stroke="#2a2f3a" stroke-width="1.5" />
      <text x="860" y="282" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="28" fill="${TEXT_WHITE}">OpenCode — Composer</text>
      <rect x="860" y="315" width="700" height="160" rx="12" fill="#121419" />
      <text x="890" y="368" font-family="'${FONT_MONO}'" font-weight="400" font-size="24" fill="${TEXT_SOFT}">fn start_recording_with_target(&amp;mut self)</text>
      <text x="890" y="412" font-family="'${FONT_MONO}'" font-weight="400" font-size="24" fill="${ACCENT_GREEN}">// 4.2ms non-blocking startup</text>

      <rect x="160" y="200" width="1600" height="${Math.max(y - 200.0, 0.5)}" fill="#000000" fill-opacity="0.52" />
      <rect x="160" y="${y + height}" width="1600" height="${Math.max(830.0 - (y + height), 0.5)}" fill="#000000" fill-opacity="0.52" />
      <rect x="160" y="${y}" width="${Math.max(x - 160.0, 0.5)}" height="${height}" fill="#000000" fill-opacity="0.52" />
      <rect x="${x + width}" y="${y}" width="${Math.max(1760.0 - (x + width), 0.5)}" height="${height}" fill="#000000" fill-opacity="0.52" />

      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"
          fill="${ACCENT_BLUE}" fill-opacity="${windowMode ? 0.14 : 0}"
          stroke="${stroke}" stroke-width="3" />

      <rect x="${x + width * 0.5 - 140.0}" y="${y + height * 0.5 - 22.0}" width="280" height="44" rx="22" fill="#18191df2" stroke="#ffffff33" stroke-width="1.5" />
      <text x="${x + width * 0.5}" y="${y + height * 0.5 + 8.0}" text-anchor="middle" font-family="'${FONT_MONO}'" font-weight="400" font-size="22" fill="${TEXT_WHITE}">
          ${label}
      </text>

      <g opacity="${windowMode ? 1 : 0}">
          <circle cx="${cameraX}" cy="${cameraY}" r="34" fill="#16171bf0" stroke="#ffffff55" stroke-width="2" />
          <rect x="${cameraX - 8.0}" y="${cameraY - 16.0}" width="16" height="5" rx="2" fill="${TEXT_WHITE}" />
          <rect x="${cameraX - 18.0}" y="${cameraY - 11.0}" width="36" height="24" rx="6" fill="${TEXT_WHITE}" />
          <circle cx="${cameraX}" cy="${cameraY + 1.0}" r="7.5" fill="#16171b" />
          <circle cx="${cameraX}" cy="${cameraY + 1.0}" r="3.5" fill="${TEXT_WHITE}" />
      </g>

      ${keycap(780.0, 880.0, 360.0, "Space  (Camera Mode)", spacePress)}
  </g>
  `;
}
