import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ff, localMedia, source, type Source } from "./media.ts";
import { policy } from "./plan.ts";

function sample(shot: Source, name: string, times: number[], cwd: string) {
  const columns = Math.min(3, times.length);
  const labels = times.map((time) =>
    shot.image ? basename(shot.file) : `${time} ms`,
  );
  const entries = times.map((time, index) => {
    const label = `sample-label-${index}.txt`;
    const frame = `sample-${index}.jpg`;
    writeFileSync(join(cwd, label), labels[index]);
    ff(
      [
        ...(!shot.image ? ["-ss", String(time / 1000)] : []),
        ...localMedia,
        "-i",
        shot.file,
        "-vf",
        `scale=400:225:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=416:258:(ow-iw)/2:6:color=0x231e29,setsar=1,drawtext=font=DejaVu Sans:textfile=${label}:expansion=none:fontcolor=white:fontsize=18:x=(w-tw)/2:y=234`,
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-q:v",
        "2",
        "-update",
        "1",
        "-y",
        frame,
      ],
      cwd,
    );
    return frame;
  });
  if (entries.length === 1) {
    ff(
      [
        "-i",
        entries[0],
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-update",
        "1",
        name,
      ],
      cwd,
    );
    return;
  }
  const grid = entries
    .map(
      (_, index) =>
        `${(index % columns) * 416}_${Math.floor(index / columns) * 258}`,
    )
    .join("|");
  const inputs = entries.flatMap((file) => ["-i", file]);
  const graph = `${entries.map((_, index) => `[${index}:v]`).join("")}xstack=inputs=${entries.length}:layout=${grid}:fill=0x231e29`;
  ff(
    [
      ...inputs,
      "-filter_complex",
      graph,
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-q:v",
      "2",
      "-update",
      "1",
      name,
    ],
    cwd,
  );
}

type Options = {
  paths: string[];
  frames: number;
  fromMs?: number;
  toMs?: number;
  starterPlan: boolean;
};

function starterPlan(shots: Source[]) {
  const [first, second = first] = shots;
  const reference = ({ file, image }: Source) =>
    image ? { file } : { file, atMs: 0 };
  return {
    version: 1,
    scenes: [
      { shots: shots.slice(0, 2).map(reference), say: [] },
      { shots: [reference(first)], say: [] },
      { shots: [reference(second)], say: [] },
    ],
  };
}

export function inspect(options: Options, output: string, cwd: string) {
  const { paths, frames, fromMs, toMs } = options;
  if (paths.length < 1 || paths.length > 8)
    throw Error("Inspect needs 1–8 local media files.");
  if (!Number.isInteger(frames) || frames < 2 || frames > 18)
    throw Error("--frames must be between 2 and 18.");
  if (paths.length !== 1 && (fromMs !== undefined || toMs !== undefined))
    throw Error("Select one video when using --from-ms or --to-ms.");
  const shots = paths.map((file) => source({ file }, cwd));
  const result = shots.map((shot, index) => {
    const name = `source-${index + 1}.jpg`;
    const from = fromMs ?? 0;
    const to = toMs ?? Math.max(from, shot.durationMs - 150);
    if (
      (fromMs !== undefined || toMs !== undefined) &&
      (shot.image || !policy.clip_valid(from, to, shot.durationMs - 1))
    )
      throw Error(
        `Choose a video range with 0 ≤ fromMs < toMs < ${shot.durationMs}.`,
      );
    const times = shot.image
      ? [0]
      : [
          ...new Set(
            Array.from({ length: frames }, (_, index) =>
              policy.sample_time(from, to - from, index, frames),
            ),
          ),
        ];
    sample(shot, name, times, cwd);
    return {
      file: shot.file,
      width: shot.width,
      height: shot.height,
      durationMs: shot.durationMs,
      sheet: join(output, name),
      samplesMs: shot.image ? [] : times,
    };
  });
  const record = {
    sources: result,
    evidence: join(output, "evidence.json"),
    ...(options.starterPlan
      ? { starterPlan: join(output, "starter-plan.json") }
      : {}),
  };
  const assets = result.map((entry) => basename(entry.sheet));
  if (options.starterPlan) {
    writeFileSync(
      join(cwd, "starter-plan.json"),
      JSON.stringify(starterPlan(shots), null, 2) + "\n",
    );
    assets.push("starter-plan.json");
  }
  writeFileSync(
    join(cwd, "evidence.json"),
    JSON.stringify(record, null, 2) + "\n",
  );
  return { record, assets: [...assets, "evidence.json"] };
}
