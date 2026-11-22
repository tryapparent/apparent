import policy from "./circle-label.mjs";

export interface Word {
  text: string;
  line: number;
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
}
interface Category {
  index: number;
  label: string;
  score: number;
}
export interface Crop {
  rgba: Uint8Array;
  width: number;
  height: number;
  points: number[][];
}
type Ocr = (
  rgba: Uint8Array,
  w: number,
  h: number,
  mode: "auto" | "line",
) => Promise<Word[]>;
type Classify = (rgba: Uint8Array, w: number, h: number) => Promise<Category[]>;

const score = (confidence: number) =>
  Number.isFinite(confidence)
    ? Math.round(Math.max(0, Math.min(1, confidence)) * 1000)
    : 0;

function inside(x: number, y: number, points: number[][]) {
  let winding = 0;
  let a = points[points.length - 1];
  for (const b of points) {
    if (
      a[1] > y !== b[1] > y &&
      x < a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1])
    ) {
      winding += b[1] > a[1] ? 1 : -1;
    }
    a = b;
  }
  return winding !== 0;
}

function selectedPixels(crop: Crop) {
  const pixels = new Uint8Array(crop.rgba.length);
  pixels.fill(128);
  for (let y = 0; y < crop.height; y++) {
    const cuts: number[] = [];
    let a = crop.points[crop.points.length - 1];
    for (const b of crop.points) {
      const scan = y + 0.5;
      if (a[1] > scan !== b[1] > scan) {
        cuts.push(a[0] + ((scan - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      a = b;
    }
    cuts.sort((a, b) => a - b);
    const offset = y * crop.width * 4;
    for (let x = 3; x < crop.width * 4; x += 4) pixels[offset + x] = 255;
    for (let i = 0; i + 1 < cuts.length; i += 2) {
      const start =
        offset +
        4 * Math.min(crop.width, Math.max(0, Math.ceil(cuts[i] - 0.5)));
      const end =
        offset +
        4 * Math.min(crop.width, Math.max(0, Math.ceil(cuts[i + 1] - 0.5)));
      pixels.set(crop.rgba.subarray(start, end), start);
    }
  }
  return pixels;
}

function readLines(
  words: Word[],
  points: number[][],
  left: number,
  top: number,
) {
  const lines = new Map<number, { words: string[]; uncertain: boolean }>();
  for (const word of words.slice(0, 256)) {
    const box = word.box;
    let hits = 0;
    for (const fx of [0.15, 0.5, 0.85]) {
      for (const fy of [0.25, 0.75]) {
        if (
          inside(
            left + box.x + box.width * fx,
            top + box.y + box.height * fy,
            points,
          )
        )
          hits++;
      }
    }
    const admission = policy.word_admission(hits, score(word.confidence));
    if (admission === 0) continue;
    const line = lines.get(word.line) ?? { words: [], uncertain: false };
    const text = word.text.replace(/[\p{Cc}\p{Cf}“”]/gu, " ").trim();
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    if (admission === 1) line.uncertain = true;
    else line.words.push(text);
    lines.set(word.line, line);
  }
  return [...lines.values()]
    .filter((line) => !line.uncertain)
    .map((line) => line.words.join(" "))
    .filter(
      (text) =>
        /[\p{L}\p{N}]/u.test(text) && text.length >= 2 && text.length <= 90,
    )
    .slice(0, 3);
}

function objectName(classes: Category[]) {
  if (!classes.length) return "";
  const top = classes.reduce((best, row) =>
    row.score > best.score ? row : best,
  );
  const family = policy.family(top.index);
  const combined = classes.reduce(
    (sum, row) => sum + (policy.family(row.index) === family ? row.score : 0),
    0,
  );
  const generic =
    /web\s?site|monitor|screen|television|computer keyboard/i.test(top.label);
  switch (policy.category(family, score(combined), score(top.score), generic)) {
    case 1:
      return "dog";
    case 2:
      return "cat";
    case 3:
      return top.label.split(",")[0].trim();
    default:
      return "";
  }
}

function subregion(crop: Crop, caption: boolean) {
  const width = caption
    ? crop.width
    : Math.max(1, Math.round(crop.width * 0.65));
  const height = Math.max(1, Math.round(crop.height * (caption ? 0.21 : 0.36)));
  const x = Math.floor((crop.width - width) / 2);
  const y = caption
    ? crop.height - height
    : Math.floor((crop.height - height) / 2);
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const start = ((y + row) * crop.width + x) * 4;
    pixels.set(crop.rgba.subarray(start, start + width * 4), row * width * 4);
  }
  return { pixels, x, y, width, height };
}

export async function recognizeCircle(
  crop: Crop,
  ocr: Ocr,
  classify: Classify,
) {
  const [words, categories] = await Promise.all([
    ocr(crop.rgba, crop.width, crop.height, "auto").catch(() => []),
    classify(selectedPixels(crop), crop.width, crop.height).catch(() => []),
  ]);
  const category = objectName(categories);
  let lines = readLines(words, crop.points, 0, 0);
  const region = policy.retry_region(
    lines.length > 0,
    Boolean(category),
    crop.width >= 1.4 * crop.height,
  );
  if (region) {
    const r = subregion(crop, region === 2);
    const retry = await ocr(r.pixels, r.width, r.height, "line").catch(
      () => [],
    );
    lines = readLines(retry, crop.points, r.x, r.y);
  }
  const include = policy.include_category(
    lines.length > 0,
    crop.width > 2 * crop.height,
    lines.length,
  );
  return [
    include && category ? `image “${category}”` : "",
    ...lines.map((line) => `“${line}”`),
  ]
    .filter(Boolean)
    .join(", ");
}
