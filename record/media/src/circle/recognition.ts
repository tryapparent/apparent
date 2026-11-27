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

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

function readLines(
  words: Word[],
  crop: Crop,
  region: Region,
  hasCategory: boolean,
) {
  const lines = new Map<
    number,
    { words: string[]; uncertain: boolean; bounds: number[] }
  >();
  for (const word of words.slice(0, 256)) {
    const box = word.box;
    const text = word.text.replace(/[\p{Cc}\p{Cf}“”]/gu, " ").trim();
    const truncated = /…|\.{2,}/u.test(text);
    if (!truncated && !/[\p{L}\p{N}]/u.test(text)) continue;
    const x = region.x + box.x;
    const y = region.y + box.y;
    let hits = 0;
    for (const fx of [0, 0.5, 1]) {
      for (const fy of [0, 0.5, 1]) {
        if (inside(x + box.width * fx, y + box.height * fy, crop.points))
          hits++;
      }
    }
    const complete =
      !truncated &&
      box.x > 1 &&
      box.y > 1 &&
      box.x + box.width < region.width - 1 &&
      box.y + box.height < region.height - 1;
    const admission = policy.word_admission(
      hits,
      score(word.confidence),
      complete,
    );
    if (admission === 0) continue;
    const line = lines.get(word.line) ?? {
      words: [],
      uncertain: false,
      bounds: [x, y, x + box.width, y + box.height],
    };
    if (admission === 1) {
      line.uncertain = true;
    } else {
      line.words.push(text);
      const [left, top, right, bottom] = line.bounds;
      line.bounds = [
        Math.min(left, x),
        Math.min(top, y),
        Math.max(right, x + box.width),
        Math.max(bottom, y + box.height),
      ];
    }
    lines.set(word.line, line);
  }
  const observed = [...lines.values()];
  const text = observed
    .filter(({ uncertain, bounds: [left, top, right, bottom] }) =>
      policy.select_line(
        uncertain,
        Math.abs(left + right - crop.width) <= crop.width * 0.5,
        Math.abs(top + bottom - crop.height) <= crop.height * 0.5,
        hasCategory,
      ),
    )
    .map((line) => line.words.join(" "))
    .filter(
      (text) => /[\p{L}\p{N}]/u.test(text) && policy.label_length(text.length),
    )
    .slice(0, 3);
  return { text, uncertain: observed.some((line) => line.uncertain) };
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
  ocr: Ocr | undefined,
  classify: Classify,
) {
  const [words, categories] = await Promise.all([
    ocr?.(crop.rgba, crop.width, crop.height, "auto").catch(() => []) ?? [],
    classify(selectedPixels(crop), crop.width, crop.height).catch(() => []),
  ]);
  const category = objectName(categories);
  const hasCategory = Boolean(category);
  let { text, uncertain } = readLines(
    words,
    crop,
    { x: 0, y: 0, width: crop.width, height: crop.height },
    hasCategory,
  );
  const region = policy.retry_region(
    text.length > 0,
    uncertain,
    hasCategory,
    crop.width >= 1.4 * crop.height,
  );
  if (region && ocr) {
    const r = subregion(crop, region === 2);
    const retry = await ocr(r.pixels, r.width, r.height, "line").catch(
      () => [],
    );
    text = readLines(retry, crop, r, hasCategory).text;
  }
  return [
    category ? `image “${category}”` : "",
    ...(policy.include_caption(hasCategory, text.length) ? text : []).map(
      (line) => `“${line}”`,
    ),
  ]
    .filter(Boolean)
    .join(", ");
}
