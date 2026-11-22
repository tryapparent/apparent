import {
  ACCENT_BLUE,
  ACCENT_GREEN,
  ACCENT_RED,
  CARD_BG,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_SANS,
  LINE_SUBTLE,
  TEXT_MUTED,
  TEXT_SOFT,
  TEXT_WHITE,
  smoothstep,
  spring,
} from "./art.ts";

export function bundle(t: number): string {
  const opacity = smoothstep(0, 0.25, t) * (1 - smoothstep(4.65, 4.98, t));
  const firstCardOpacity = smoothstep(0.35, 0.75, t);
  const secondCardOpacity = smoothstep(0.65, 1.05, t);
  const contactSheetX = -40 * (1 - spring(t - 0.1, 180, 20));
  const summaryX = 40 * (1 - spring(t - 0.22, 180, 20));

  return `
  <g opacity="${opacity}">
      <text x="160" y="102" font-family="'${FONT_MONO}'" font-weight="400" font-size="28" fill="${ACCENT_GREEN}">
          STEP 03 · COMPACT AGENT BUNDLE
      </text>
      <text x="160" y="158" font-family="'${FONT_DISPLAY}'" font-weight="700" font-size="52" fill="${TEXT_WHITE}">
          3 · Labeled Frames in Image, Transcript in Text
      </text>

      <g transform="translate(${contactSheetX} 0)">
          <rect x="160" y="210" width="760" height="740" rx="20" fill="${CARD_BG}" stroke="${LINE_SUBTLE}" stroke-width="2" />
          <text x="200" y="262" font-family="'${FONT_MONO}'" font-weight="400" font-size="24" fill="${TEXT_MUTED}">
              contact-sheet.png  (pure labeled grid)
          </text>
          <use href="#contact-sheet" x="190" y="285" width="700" height="635" />
      </g>

      <g transform="translate(${summaryX} 0)">
          <rect x="960" y="210" width="800" height="740" rx="20" fill="${CARD_BG}" stroke="${LINE_SUBTLE}" stroke-width="2" />
          <text x="1000" y="262" font-family="'${FONT_MONO}'" font-weight="400" font-size="24" fill="${TEXT_MUTED}">
              summary.md  (time-aligned transcript + paths)
          </text>
          <text x="1000" y="326" font-family="'${FONT_MONO}'" font-weight="400" font-size="26" fill="${ACCENT_GREEN}">
              [apparent 0:32 · OpenCode]
          </text>

          <g opacity="${firstCardOpacity}">
              <rect x="996" y="365" width="728" height="220" rx="16" fill="#13151b" stroke="#2c313d" stroke-width="1.5" />
              <rect x="1020" y="390" width="148" height="36" rx="18" fill="#261719" stroke="${ACCENT_RED}" stroke-width="1.5" />
              <text x="1094" y="415" text-anchor="middle" font-family="'${FONT_MONO}'" font-weight="400" font-size="21" fill="${TEXT_WHITE}">
                  #1 · 0:15
              </text>
              <text x="1188" y="415" font-family="'${FONT_MONO}'" font-weight="400" font-size="22" fill="${TEXT_SOFT}">
                  clicked (x 0.44, y 0.40)
              </text>
              <text x="1020" y="468" font-family="'${FONT_SANS}'" font-weight="500" font-size="26" fill="${TEXT_WHITE}">
                  “As I drag between these session tabs,
              </text>
              <text x="1020" y="506" font-family="'${FONT_SANS}'" font-weight="500" font-size="26" fill="${TEXT_WHITE}">
                  there's a little dead space between each one.”
              </text>
              <text x="1020" y="555" font-family="'${FONT_MONO}'" font-weight="400" font-size="20" fill="${TEXT_MUTED}">
                  frames/frame-01.png
              </text>
          </g>

          <g opacity="${secondCardOpacity}">
              <rect x="996" y="615" width="728" height="220" rx="16" fill="#13151b" stroke="#2c313d" stroke-width="1.5" />
              <rect x="1020" y="640" width="148" height="36" rx="18" fill="#261719" stroke="${ACCENT_RED}" stroke-width="1.5" />
              <text x="1094" y="665" text-anchor="middle" font-family="'${FONT_MONO}'" font-weight="400" font-size="21" fill="${TEXT_WHITE}">
                  #2 · 0:17
              </text>
              <text x="1188" y="665" font-family="'${FONT_MONO}'" font-weight="400" font-size="22" fill="${TEXT_SOFT}">
                  marked region x 0.41–0.44
              </text>
              <text x="1020" y="718" font-family="'${FONT_SANS}'" font-weight="500" font-size="26" fill="${TEXT_WHITE}">
                  “It would be nice if it always highlighted
              </text>
              <text x="1020" y="756" font-family="'${FONT_SANS}'" font-weight="500" font-size="26" fill="${TEXT_WHITE}">
                  the closest one in the sidebar.”
              </text>
              <text x="1020" y="805" font-family="'${FONT_MONO}'" font-weight="400" font-size="20" fill="${TEXT_MUTED}">
                  frames/frame-02.png
              </text>
          </g>

          <text x="1000" y="902" font-family="'${FONT_MONO}'" font-weight="400" font-size="22" fill="${ACCENT_BLUE}">
              Look closer: apparent frames 'latest' --from 0:00 --to 0:32
          </text>
      </g>
  </g>
  `;
}
