import {
  ACCENT_BLUE,
  ACCENT_GREEN,
  CARD_BG,
  FONT_DISPLAY,
  FONT_MONO,
  PILL_BG,
  TEXT_MUTED,
  TEXT_WHITE,
  clamp,
  shortcut,
  smoothstep,
} from "./art.ts";

export function paste(t: number): string {
  const opacity = smoothstep(0, 0.25, t);
  const press = clamp(
    smoothstep(0.65, 0.85, t) * (1 - smoothstep(1.15, 1.35, t)),
  );
  const imageOpacity = smoothstep(0.95, 1.25, t);
  const textOpacity = smoothstep(1.25, 1.6, t);

  return `
  <g opacity="${opacity}">
      <text x="160" y="102" font-family="'${FONT_MONO}'" font-weight="400" font-size="28" fill="${ACCENT_GREEN}">
          STEP 04 · TWO-STEP PASTE HANDOFF
      </text>
      <text x="160" y="158" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="52" fill="${TEXT_WHITE}">
          4 · Press Ctrl+Opt+Shift+V to Paste Both
      </text>

      <rect x="1280" y="68" width="480" height="54" rx="27" fill="${PILL_BG}" stroke="#5cd69666" stroke-width="1.5" />
      <circle cx="1314" cy="95" r="14" fill="#34c75933" />
      <text x="1314" y="102" text-anchor="middle" font-family="'${FONT_MONO}'" font-weight="400" font-size="20" fill="${ACCENT_GREEN}">✓</text>
      <text x="1380" y="101" text-anchor="middle" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="20" fill="${TEXT_WHITE}">Copied</text>
      <text x="1508" y="101" text-anchor="middle" font-family="'${FONT_MONO}'" font-weight="400" font-size="19" fill="${TEXT_MUTED}">· 2 frames · ⌃⌥⇧V</text>
      <rect x="1618" y="76" width="96" height="38" rx="19" fill="${ACCENT_BLUE}" />
      <text x="1666" y="101" text-anchor="middle" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="19" fill="${TEXT_WHITE}">Inspect</text>
      <text x="1736" y="102" text-anchor="middle" font-family="'${FONT_MONO}'" font-weight="400" font-size="19" fill="${TEXT_MUTED}">x</text>

      <rect x="240" y="235" width="1440" height="560" rx="24" fill="${CARD_BG}" stroke="#343a48" stroke-width="2" />
      <text x="290" y="295" font-family="'${FONT_MONO}'" font-weight="400" font-size="24" fill="${TEXT_MUTED}">
          OpenCode Prompt Composer
      </text>

      <g opacity="${imageOpacity}">
          <rect x="290" y="330" width="495" height="72" rx="16" fill="#1f2637" stroke="${ACCENT_BLUE}" stroke-width="2" />
          <text x="322" y="375" font-family="'${FONT_MONO}'" font-weight="400" font-size="25" fill="${TEXT_WHITE}">
              [Image 1: contact-sheet.png]
          </text>
          <text x="815" y="375" font-family="'${FONT_MONO}'" font-weight="400" font-size="22" fill="${ACCENT_GREEN}">
              ← 1st ⌘V attaches contact sheet
          </text>
      </g>

      <g opacity="${textOpacity}">
          <rect x="290" y="428" width="1340" height="320" rx="16" fill="#12141a" stroke="#282d38" stroke-width="1.5" />
          <text x="325" y="478" font-family="'${FONT_MONO}'" font-weight="400" font-size="24" fill="${ACCENT_GREEN}">
              [apparent 0:32 · OpenCode]   ← 2nd ⌘V (160ms later) inserts aligned text
          </text>
          <text x="325" y="532" font-family="'${FONT_MONO}'" font-weight="400" font-size="23" fill="${TEXT_WHITE}">
              - [#1 · 0:15] clicked (x 0.44, y 0.40) — “As I drag between these session tabs…”
          </text>
          <text x="325" y="582" font-family="'${FONT_MONO}'" font-weight="400" font-size="23" fill="${TEXT_WHITE}">
              - [#2 · 0:17] marked region x 0.41–0.44 — “It would be nice if it always highlighted…”
          </text>
          <text x="325" y="642" font-family="'${FONT_MONO}'" font-weight="400" font-size="21" fill="${TEXT_MUTED}">
              Video: ~/Library/Application Support/apparent/captures/…/recording.mp4
          </text>
          <text x="325" y="688" font-family="'${FONT_MONO}'" font-weight="400" font-size="21" fill="${ACCENT_BLUE}">
              Look closer: apparent frames 'latest' --from 0:00 --to 0:32 --fps 4
          </text>
      </g>

      ${shortcut("V", 865, press)}
  </g>
  `;
}
