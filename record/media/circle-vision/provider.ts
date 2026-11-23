import { readFile } from "node:fs/promises";
import { types } from "node:util";

type Prediction = { index: number; label: string; score: number };
type Filter = { start: number; weights: number[] };

const crop = 224;
const resizeEdge = 256;
const classCount = 1000;
const maxDimension = 8192;
const maxPixels = 16_777_216;
const mean = [0.485, 0.456, 0.406];
const std = [0.229, 0.224, 0.225];

function bicubic(distance: number): number {
  const x = Math.abs(distance);
  if (x < 1) return (1.5 * x - 2.5) * x * x + 1;
  if (x < 2) return ((-0.5 * x + 2.5) * x - 4) * x + 2;
  return 0;
}

function cropFilters(length: number, resized: number): Filter[] {
  const step = length / resized;
  const scale = Math.max(1, step);
  const offset = Math.floor((resized - crop) / 2);
  return Array.from({ length: crop }, (_, pixel) => {
    const center = (offset + pixel + 0.5) * step - 0.5;
    const start = Math.max(0, Math.ceil(center - 2 * scale));
    const end = Math.min(length - 1, Math.floor(center + 2 * scale));
    const weights = Array.from({ length: end - start + 1 }, (_, sample) =>
      bicubic((start + sample - center) / scale),
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return { start, weights: weights.map((weight) => weight / total) };
  });
}

function modelInput(
  rgba: Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const shortEdge = Math.min(width, height);
  const xs = cropFilters(width, Math.floor((width * resizeEdge) / shortEdge));
  const ys = cropFilters(height, Math.floor((height * resizeEdge) / shortEdge));
  const firstRow = ys[0].start;
  const lastFilter = ys[crop - 1];
  const pastLastRow = lastFilter.start + lastFilter.weights.length;
  const intermediate = new Float32Array((pastLastRow - firstRow) * crop * 3);

  for (let row = firstRow; row < pastLastRow; row++) {
    for (let col = 0; col < crop; col++) {
      const { start, weights } = xs[col];
      let pixel = (row * width + start) * 4;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (const weight of weights) {
        const alpha = rgba[pixel + 3] / 255;
        const white = 255 * (1 - alpha);
        red += weight * (rgba[pixel] * alpha + white);
        green += weight * (rgba[pixel + 1] * alpha + white);
        blue += weight * (rgba[pixel + 2] * alpha + white);
        pixel += 4;
      }
      const index = ((row - firstRow) * crop + col) * 3;
      intermediate[index] = red;
      intermediate[index + 1] = green;
      intermediate[index + 2] = blue;
    }
  }

  const plane = crop * crop;
  const result = new Float32Array(3 * plane);
  for (let row = 0; row < crop; row++) {
    const { start, weights } = ys[row];
    for (let col = 0; col < crop; col++) {
      for (let channel = 0; channel < 3; channel++) {
        let pixel = ((start - firstRow) * crop + col) * 3 + channel;
        let value = 0;
        for (const weight of weights) {
          value += weight * intermediate[pixel];
          pixel += crop * 3;
        }
        const rgb = Math.min(255, Math.max(0, value)) / 255;
        result[channel * plane + row * crop + col] =
          (rgb - mean[channel]) / std[channel];
      }
    }
  }
  return result;
}

async function initialize() {
  const [ort, model, wasm, labelsJson] = await Promise.all([
    import("./ort.wasm.min.mjs"),
    readFile(new URL("./model.onnx", import.meta.url)),
    readFile(new URL("./ort-wasm-simd-threaded.wasm", import.meta.url)),
    readFile(new URL("./labels.json", import.meta.url), "utf8"),
  ]);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmBinary = wasm;
  ort.env.wasm.wasmPaths = {
    mjs: new URL("./ort-wasm-simd-threaded.mjs", import.meta.url).href,
  };
  const session = await ort.InferenceSession.create(model, {
    executionProviders: ["wasm"],
  });
  const labels: string[] = JSON.parse(labelsJson);
  return { session, labels, Tensor: ort.Tensor };
}

let initialized: ReturnType<typeof initialize> | undefined;

export async function recognize(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Prediction[]> {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > maxDimension ||
    height > maxDimension ||
    width * height > maxPixels ||
    !types.isUint8Array(rgba) ||
    rgba.length !== width * height * 4
  ) {
    throw new RangeError(
      "Expected tightly packed RGBA8 within 8192 pixels per side and 16,777,216 pixels total",
    );
  }

  initialized ??= initialize();
  const { session, labels, Tensor } = await initialized;
  const input = new Tensor("float32", modelInput(rgba, width, height), [
    1,
    3,
    crop,
    crop,
  ]);
  const outputName = session.outputNames[0];
  try {
    const output = (await session.run({ [session.inputNames[0]]: input }))[
      outputName
    ];
    try {
      const logits: Float32Array = output.data;
      if (logits.length !== classCount || !logits.every(Number.isFinite)) {
        throw new Error("Invalid MobileNet classifier output");
      }
      const max = logits.reduce(
        (peak, logit) => Math.max(peak, logit),
        -Infinity,
      );
      const weights = Array.from(logits, (logit) => Math.exp(logit - max));
      const sum = weights.reduce((total, weight) => total + weight, 0);
      return weights
        .map((weight, index) => ({
          index,
          label: labels[index],
          score: weight / sum,
        }))
        .sort((a, b) => b.score - a.score || a.index - b.index);
    } finally {
      output.dispose();
    }
  } finally {
    input.dispose();
  }
}
