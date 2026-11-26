import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";
import { policy, type Shot } from "./plan.ts";

const width = 1280;
const height = 720;
const rate = 30;
const background = "0x231e29";
const imageTypes = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const videoTypes = new Set([".mp4", ".mov", ".webm", ".mkv"]);
export const localMedia = [
  "-protocol_whitelist",
  "file",
  "-format_whitelist",
  "mov,matroska,webm,image2,png_pipe,jpeg_pipe,webp_pipe",
];

export type Source = Shot & {
  durationMs: number;
  image: boolean;
  width: number;
  height: number;
};

export function run(
  program: string,
  args: string[],
  cwd: string,
  timeout = 120_000,
) {
  const result = spawnSync(program, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 128 * 1024,
    killSignal: "SIGKILL",
    timeout,
  });
  if (result.error) throw Error(`${program}: ${result.error.message}`);
  if (result.status !== 0)
    throw Error(
      `${program} failed: ${result.stderr.trim().slice(-1400) || result.signal || result.status}`,
    );
  return result.stdout;
}

export function ff(args: string[], cwd: string) {
  return run(
    "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-filter_complex_threads",
      "1",
      ...args,
    ],
    cwd,
  );
}

type Probe = {
  format: { duration?: string };
  streams: {
    codec_type: string;
    duration?: string;
    avg_frame_rate?: string;
    channels?: number;
    width?: number;
    height?: number;
  }[];
};

export function probe(file: string, cwd: string, localOnly = false): Probe {
  return JSON.parse(
    run(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,duration,avg_frame_rate,channels,width,height",
        "-of",
        "json",
        ...(localOnly ? localMedia : []),
        file,
      ],
      cwd,
    ),
  );
}

export function source(shot: Shot, cwd: string): Source {
  const file = realpathSync(shot.file);
  if (!statSync(file).isFile())
    throw Error(`Expected a local regular media file: ${shot.file}`);
  const extension = extname(file).toLowerCase();
  const image = imageTypes.has(extension);
  if (!image && !videoTypes.has(extension))
    throw Error(
      `Unsupported media extension for ${file}. Use PNG, JPEG, WebP, MP4, MOV, MKV or WebM.`,
    );
  const info = probe(file, cwd, true);
  const video = info.streams.find((stream) => stream.codec_type === "video");
  if (
    !video ||
    !video.width ||
    !video.height ||
    video.width > 7680 ||
    video.height > 7680
  )
    throw Error(
      `Expected a readable visual stream up to 7680 pixels per side: ${file}`,
    );
  const { width: pixelWidth, height: pixelHeight } = video;
  let box = shot.box;
  if (shot.boxPixels) {
    const [x, y, w, h] = shot.boxPixels;
    if (
      !policy.axis_fits(x, w, pixelWidth) ||
      !policy.axis_fits(y, h, pixelHeight)
    )
      throw Error(
        `boxPixels must fit the ${pixelWidth}×${pixelHeight} source: ${file}`,
      );
    box = [x / pixelWidth, y / pixelHeight, w / pixelWidth, h / pixelHeight];
  }
  if (image) {
    if (shot.fromMs !== undefined || shot.atMs !== undefined)
      throw Error(`Remove timestamps from still image ${file}.`);
    return {
      ...shot,
      file,
      durationMs: 0,
      image,
      width: pixelWidth,
      height: pixelHeight,
      box,
    };
  }
  const durationMs = Math.floor(
    1000 * Number(video.duration ?? info.format.duration),
  );
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    durationMs > 3_600_000
  )
    throw Error(`Expected a video of at most one hour: ${file}`);
  if (shot.fromMs !== undefined && shot.toMs !== undefined) {
    if (!policy.clip_valid(shot.fromMs, shot.toMs, durationMs))
      throw Error(`Clip must have fromMs < toMs ≤ ${durationMs} for ${file}.`);
  } else if (!policy.still_valid(shot.atMs ?? 0, durationMs)) {
    throw Error(`Choose atMs before ${durationMs} for ${file}.`);
  }
  return {
    ...shot,
    file,
    durationMs,
    image,
    width: pixelWidth,
    height: pixelHeight,
    box,
  };
}

export function readSpeech(file: string) {
  const limit = 24_000 * 2 * 30 + 4096;
  const fd = openSync(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let bytes: Buffer;
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size < 12 || info.size > limit)
      throw Error(
        "Local narrator must return a regular PCM WAV of at most 30 seconds.",
      );
    bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) throw Error("Local narrator WAV ended early.");
      offset += count;
    }
  } finally {
    closeSync(fd);
  }
  if (
    bytes.length > 24_000 * 2 * 30 + 4096 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  )
    throw Error("Local narrator must return a PCM WAV of at most 30 seconds.");
  let mono = false;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const kind = bytes.toString("ascii", offset, offset + 4);
    const count = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + count > bytes.length) break;
    if (kind === "fmt " && count >= 16)
      mono =
        bytes.readUInt16LE(start) === 1 &&
        bytes.readUInt16LE(start + 2) === 1 &&
        bytes.readUInt32LE(start + 4) === 24_000 &&
        bytes.readUInt16LE(start + 14) === 16;
    if (kind === "data" && mono && count > 0 && count % 2 === 0) {
      const pcm = bytes.subarray(start, start + count);
      if (pcm.every((byte) => byte === 0))
        throw Error("Local narrator returned silent PCM.");
      return { pcm, wav: bytes, ms: Math.ceil(count / 48) };
    }
    offset = start + count + (count % 2);
  }
  throw Error("Local narrator must return nonempty, mono, 24 kHz PCM16.");
}

export function captionTime(frame: number) {
  const ms = Math.round((frame * 1000) / rate);
  return (
    [
      Math.floor(ms / 3_600_000),
      Math.floor(ms / 60_000) % 60,
      Math.floor(ms / 1000) % 60,
    ]
      .map((part) => String(part).padStart(2, "0"))
      .join(":") +
    "," +
    String(ms % 1000).padStart(3, "0")
  );
}

export function cue(index: number, from: number, to: number, text: string) {
  return `${index}\n${captionTime(from)} --> ${captionTime(to)}\n${text}\n\n`;
}

const subtitles =
  "subtitles=caption.srt:force_style='FontName=DejaVu Sans,FontSize=19,PrimaryColour=&H00F5F0E8,OutlineColour=&H0016111C,BorderStyle=3,Outline=4,Shadow=0,Alignment=2,MarginV=10'";

function panel(
  shot: Source,
  index: number,
  panelWidth: number,
  paired: boolean,
  cwd: string,
) {
  const label = shot.label ? 44 : 12;
  const pictureHeight = 630 - label;
  const filters = [
    "fps=30",
    `scale=${panelWidth - (paired ? 20 : 32)}:${pictureHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    "setsar=1",
  ];
  if (shot.box) {
    const [x, y, w, h] = shot.box;
    filters.push(
      `drawbox=x=iw*${x}:y=ih*${y}:w=iw*${w}:h=ih*${h}:color=0xff575a:t=5`,
    );
  }
  filters.push(
    `pad=${panelWidth}:630:(ow-iw)/2:${label}+(oh-${label}-ih)/2:color=${background}`,
  );
  if (shot.label) {
    const path = `label-${index}.txt`;
    writeFileSync(join(cwd, path), shot.label);
    filters.push(
      `drawtext=font=DejaVu Sans:textfile=${path}:expansion=none:fontcolor=0xf5f0e8:fontsize=26:x=(w-tw)/2:y=10`,
    );
  }
  filters.push("tpad=stop_mode=clone:stop=-1");
  return filters.join(",");
}

export function renderScene(
  shots: Source[],
  frames: number,
  captions: string,
  output: string,
  cwd: string,
) {
  writeFileSync(join(cwd, "caption.srt"), captions);
  const args: string[] = [];
  for (const shot of shots) {
    if (shot.image)
      args.push(
        ...localMedia,
        "-loop",
        "1",
        "-framerate",
        "30",
        "-i",
        shot.file,
      );
    else if (shot.fromMs !== undefined && shot.toMs !== undefined)
      args.push(
        "-ss",
        String(shot.fromMs / 1000),
        "-t",
        String((shot.toMs - shot.fromMs) / 1000),
        ...localMedia,
        "-i",
        shot.file,
      );
    else {
      ff(
        [
          "-ss",
          String((shot.atMs ?? 0) / 1000),
          ...localMedia,
          "-i",
          shot.file,
          "-frames:v",
          "1",
          "-threads",
          "1",
          "-update",
          "1",
          "-y",
          `still-${args.length}.png`,
        ],
        cwd,
      );
      args.push(
        "-loop",
        "1",
        "-framerate",
        "30",
        "-i",
        `still-${args.length}.png`,
      );
    }
  }
  const paired = shots.length === 2;
  const panels = shots.map(
    (shot, i) =>
      `[${i}:v:0]${panel(shot, i, width / shots.length, paired, cwd)}[p${i}]`,
  );
  const combined = paired ? "[p0][p1]hstack=inputs=2," : "[p0]";
  const graph = [
    ...panels,
    `${combined}pad=${width}:${height}:0:0:color=${background},${subtitles}[v]`,
  ].join(";");
  ff(
    [
      ...args,
      "-filter_complex",
      graph,
      "-map",
      "[v]",
      "-an",
      "-frames:v",
      String(frames),
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      output,
    ],
    cwd,
  );
}
