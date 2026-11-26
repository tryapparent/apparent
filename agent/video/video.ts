import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  rmdirSync,
  statSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { inspect } from "./inspect.ts";
import { dirname, join, resolve } from "node:path";
import { cue, ff, probe, renderScene, source } from "./media.ts";
import { parsePlan, policy, readPlan } from "./plan.ts";

import { checkNarrator, narration, narrator } from "./voice.ts";

function publish(cwd: string, destination: string, assets: string[]) {
  mkdirSync(destination, { mode: 0o700 });
  const created: string[] = [];
  try {
    for (const asset of assets) {
      const target = join(destination, asset);
      copyFileSync(join(cwd, asset), target, constants.COPYFILE_EXCL);
      created.push(target);
    }
  } catch (error) {
    for (const file of created) rmSync(file, { force: true });
    if (readdirSync(destination).length === 0) rmdirSync(destination);
    throw error;
  }
}

function checkOutput(output: string) {
  if (lstatSync(output, { throwIfNoEntry: false }))
    throw Error(
      `Output already exists: ${output}. Choose a new --out directory.`,
    );
  if (!existsSync(dirname(output)) || !statSync(dirname(output)).isDirectory())
    throw Error(`Output parent must exist: ${dirname(output)}.`);
}

function render(planPath: string, output: string, cwd: string, cache?: string) {
  const plan = parsePlan(readPlan(planPath), dirname(resolve(planPath)));
  const ready = plan.scenes.map((scene, index) => {
    try {
      return { ...scene, shots: scene.shots.map((shot) => source(shot, cwd)) };
    } catch (error) {
      throw Error(
        `Scene ${index + 1}: ${error instanceof Error ? error.message : error}`,
      );
    }
  });
  const narratorJob = narrator(cache);
  const clips: string[] = [];
  const cues: { pcm: Buffer; start: number }[] = [];
  const timeline: {
    startFrame: number;
    endFrame: number;
    cueFrames: number[];
  }[] = [];
  let position = 0;
  let captions = "";
  for (const [index, scene] of ready.entries()) {
    let local = 0;
    let localCaptions = "";
    const cueFrames: number[] = [];
    for (const [part, { text, startMs }] of scene.say.entries()) {
      const start =
        startMs === undefined ? local : policy.frames_for_ms(startMs);
      if (start < local)
        throw Error(
          `Scene ${index + 1}, caption ${part + 1}: startMs overlaps the previous cue. Use at least ${Math.ceil((local * 1000) / 30)} ms or shorten the previous line.`,
        );
      const spoken = narratorJob.voice(text, cwd, `voice-${index}-${part}`);
      const end = policy.caption_end(start, spoken.ms);
      cueFrames.push(position + start);
      cues.push({ pcm: spoken.pcm, start: position + start });
      localCaptions += cue(part + 1, start, end, text);
      captions += cue(cues.length, position + start, position + end, text);
      local = end;
    }
    const visual = Math.max(
      ...scene.shots.map((shot) => (shot.toMs ?? 0) - (shot.fromMs ?? 0)),
    );
    const frames = Number(policy.scene_frames(visual, local, scene.holdMs));
    if (position + frames > 5400)
      throw Error(
        `Scene ${index + 1} makes the video longer than three minutes. Shorten the plan.`,
      );
    const name = `scene-${index}.mp4`;
    renderScene(scene.shots, frames, localCaptions, name, cwd);
    clips.push(name);
    timeline.push({
      startFrame: position,
      endFrame: position + frames,
      cueFrames,
    });
    position += frames;
  }
  writeFileSync(
    join(cwd, "concat.txt"),
    clips.map((clip) => `file '${clip}'`).join("\n"),
  );
  writeFileSync(join(cwd, "captions.srt"), captions);
  const duration = position / 30;
  const pcm = Buffer.alloc(position * 1600);
  for (const { pcm: voice, start } of cues) voice.copy(pcm, start * 1600);
  writeFileSync(join(cwd, "voice.pcm"), pcm);
  ff(
    [
      "-f",
      "concat",
      "-safe",
      "1",
      "-i",
      "concat.txt",
      "-f",
      "s16le",
      "-ar",
      "24000",
      "-ac",
      "1",
      "-i",
      "voice.pcm",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-vf",
      "setpts=N/(30*TB)",
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-ac",
      "1",
      "-t",
      String(duration),
      "-movflags",
      "+faststart",
      "-metadata",
      `comment=Apparent local narration: ${narration.engine} ${narration.voice}`,
      "video.mp4",
    ],
    cwd,
  );
  const movie = probe(join(cwd, "video.mp4"), cwd);
  const [video, voice] = movie.streams;
  if (
    movie.streams.length !== 2 ||
    video.codec_type !== "video" ||
    video.avg_frame_rate !== "30/1" ||
    voice.codec_type !== "audio" ||
    voice.channels !== 1 ||
    Math.abs(Number(movie.format.duration) - duration) > 0.05
  )
    throw Error(
      "Rendered file failed the 30 fps, single mono audio track, or duration check.",
    );
  ff(
    [
      "-xerror",
      "-i",
      "video.mp4",
      "-map",
      "0:v",
      "-map",
      "0:a",
      "-f",
      "null",
      "-",
    ],
    cwd,
  );
  const reviewFrames = [
    ...new Set(
      timeline.flatMap(({ startFrame, endFrame }) => [
        startFrame,
        Math.floor((startFrame + endFrame) / 2),
        endFrame - 1,
      ]),
    ),
  ];
  const select = reviewFrames.map((frame) => `eq(n,${frame})`).join("+");
  const cols = Math.min(3, reviewFrames.length);
  const rows = Math.ceil(reviewFrames.length / cols);
  ff(
    [
      "-i",
      "video.mp4",
      "-vf",
      `select='${select}',scale=480:270,pad=480:294:0:0:color=0x231e29,drawtext=font=DejaVu Sans:text='%{pts\\:hms}':fontcolor=white:fontsize=16:x=(w-tw)/2:y=275,tile=${cols}x${rows}:color=0x231e29`,
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-q:v",
      "2",
      "-update",
      "1",
      "review.jpg",
    ],
    cwd,
  );
  const record = {
    video: join(output, "video.mp4"),
    captions: join(output, "captions.srt"),
    review: join(output, "review.jpg"),
    durationSeconds: duration,
    scenes: clips.length,
    fps: 30,
    timeline,
    reviewFrames,
    audioTracks: 1,
    voice: { ...narration, ...narratorJob.stats },
    decoded: true,
  };
  writeFileSync(
    join(cwd, "verification.json"),
    JSON.stringify(record, null, 2) + "\n",
  );
  publish(cwd, output, [
    "video.mp4",
    "captions.srt",
    "review.jpg",
    "verification.json",
  ]);
  return record;
}

function execute(
  operation: string,
  cwd: string,
  destination: string,
  args: string[],
) {
  if (operation === "narrator") return checkNarrator(cwd);
  const output = resolve(destination);
  checkOutput(output);
  if (operation === "inspect") {
    const [count, from, to, starter, ...paths] = args;
    const { record, assets } = inspect(
      {
        paths,
        frames: Number(count),
        fromMs: from === "-" ? undefined : Number(from),
        toMs: to === "-" ? undefined : Number(to),
        starterPlan: starter === "true",
      },
      output,
      cwd,
    );
    publish(cwd, output, assets);
    return record;
  }
  if (operation === "render")
    return render(resolve(args[0]), output, cwd, args[1] && resolve(args[1]));
  throw Error("Unknown video operation.");
}

try {
  const [operation, cwd, destination, ...args] = process.argv.slice(2);
  const result = execute(operation, cwd, destination, args);
  process.stdout.write(JSON.stringify({ result }) + "\n");
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }) + "\n",
  );
}
