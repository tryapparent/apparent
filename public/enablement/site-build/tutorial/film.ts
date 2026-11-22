import { ACCENT_RED, BG_DARK, clamp } from "./art.ts";
import { bundle } from "./bundle.ts";
import { draw } from "./draw.ts";
import { intro } from "./intro.ts";
import { paste } from "./paste.ts";
import { target } from "./target.ts";

export const width = 1920;
export const height = 1080;
export const fps = 60;

const scenes = [
  { render: intro, start: 0, end: 264 },
  { render: target, start: 246, end: 564 },
  { render: draw, start: 546, end: 888 },
  { render: bundle, start: 870, end: 1188 },
  { render: paste, start: 1170, end: 1439 },
];

export const frameCount = scenes[scenes.length - 1].end;

export function frameMarkup(frame: number): string {
  const progressWidth = Math.max(1, 1600 * clamp(frame / (23 * fps)));
  return `
    ${scenes
      .filter(({ start, end }) => frame >= start && frame < end)
      .map(({ start, render }) => render((frame - start) / fps))
      .join("")}
    <rect x="160" y="1024" width="1600" height="3" rx="1.5" fill="#1e222b" />
    <rect x="160" y="1024" width="${progressWidth}" height="3" rx="1.5" fill="${ACCENT_RED}" />
  `;
}

export function stageMarkup(fonts: string, images: string): string {
  return `
    <!doctype html>
    <meta charset="utf-8">
    <style>
      ${fonts}
      body { margin: 0; background: ${BG_DARK}; font-synthesis: none; }
      svg { display: block; }
    </style>
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <radialGradient id="bg-glow" cx="50%" cy="22%" r="65%">
          <stop offset="0%" stop-color="#1e2436" stop-opacity="0.75" />
          <stop offset="100%" stop-color="${BG_DARK}" />
        </radialGradient>
        ${images}
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg-glow)" />
      <g id="frame"></g>
    </svg>
  `;
}
