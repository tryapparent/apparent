import { execFileSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "./art.ts";
import {
  fps,
  frameCount,
  frameMarkup,
  height,
  stageMarkup,
  width,
} from "./film.ts";

const media = new URL("./media/", import.meta.url);
const soundtrack = fileURLToPath(new URL("soundtrack.wav", media));

function dataUrl(file: string, type: string): string {
  return `data:${type};base64,${readFileSync(new URL(file, media)).toString("base64")}`;
}

const fonts = [
  [FONT_SANS, "DMSans-Medium.ttf", 500],
  [FONT_DISPLAY, "Inter-Bold.ttf", 700],
  [FONT_MONO, "JetBrainsMono-Regular.ttf", 400],
] as const;

const images = [
  { id: "app-icon", file: "app_icon.png", width: 512, height: 512 },
  { id: "contact-sheet", file: "contact_sheet.png", width: 1600, height: 506 },
];

async function rasterize(directory: string, frames: number[]) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH,
    args: ["--force-color-profile=srgb", "--disable-lcd-text"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    const styles = fonts
      .map(
        ([name, file, weight]) =>
          `@font-face { font-family: "${name}"; font-weight: ${weight}; src: url(${dataUrl(file, "font/ttf")}); }`,
      )
      .join("\n");
    const assets = images.map((image) => ({
      ...image,
      src: dataUrl(image.file, "image/png"),
    }));
    await page.setContent(
      stageMarkup(
        styles,
        assets
          .map(
            ({ id, width, height, src }) =>
              `<symbol id="${id}" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" href="${src}" /></symbol>`,
          )
          .join(""),
      ),
    );
    await page.evaluate(
      async ({ fonts, images }) => {
        await Promise.all([
          ...fonts.map(([name, , weight]) =>
            document.fonts.load(`${weight} 30px "${name}"`),
          ),
          ...images.map(({ src }) => {
            const image = new Image();
            image.src = src;
            return image.decode();
          }),
        ]);
      },
      { fonts, images: assets },
    );

    const screenshot = await page.context().newCDPSession(page);
    for (const frame of frames) {
      await page.evaluate((markup) => {
        const target = document.getElementById("frame");
        if (!target) throw new Error("Tutorial frame container is missing");
        target.innerHTML = markup;
      }, frameMarkup(frame));
      const { data } = await screenshot.send("Page.captureScreenshot", {
        format: "png",
        optimizeForSpeed: true,
      });
      writeFileSync(
        join(directory, `${frame}.png`),
        Buffer.from(data, "base64"),
      );
    }
  } finally {
    await browser.close();
  }
}

function encode(directory: string, output: string) {
  const duration = frameCount / fps;
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "image2",
      "-framerate",
      String(fps),
      "-i",
      join(directory, "%d.png"),
      "-i",
      soundtrack,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-preset",
      "medium",
      "-tune",
      "animation",
      "-pix_fmt",
      "yuv420p",
      "-threads",
      "4",
      "-af",
      `atrim=duration=${duration},volume=-2dB,afade=t=in:d=0.25,afade=t=out:st=${duration - 0.8}:d=0.8`,
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      output,
    ],
    { stdio: "inherit" },
  );
}

const [command, path, frameArg, ...extra] = process.argv.slice(2);
const frame = Number(frameArg);
const movie =
  command === "movie" &&
  frameArg === undefined &&
  extname(path ?? "") === ".mp4";
const still =
  command === "frame" &&
  extname(path ?? "") === ".png" &&
  /^[0-9]+$/.test(frameArg ?? "") &&
  frame < frameCount;

if (!path || extra.length || (!movie && !still)) {
  console.error(
    `Usage: render.ts movie <output.mp4> | frame <output.png> <0-${frameCount - 1}>`,
  );
  process.exitCode = 1;
} else {
  const destination = resolve(path);
  if (existsSync(destination))
    throw new Error(`Output already exists: ${destination}`);
  const directory = mkdtempSync(join(dirname(destination), ".apparent-demo-"));
  try {
    const frames = movie
      ? Array.from({ length: frameCount }, (_, index) => index)
      : [frame];
    const temporary = join(directory, movie ? "demo.mp4" : `${frame}.png`);
    await rasterize(directory, frames);
    if (movie) encode(directory, temporary);
    linkSync(temporary, destination);
    console.log(destination);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
