import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";

export type Mode = "auto" | "line";
export type Word = {
  text: string;
  confidence: number;
  line: number;
  box: { x: number; y: number; width: number; height: number };
};

type TessApi = {
  Init(path: string, language: string, engineMode: number): number;
  SetPageSegMode(mode: number): void;
  SetImage(
    pointer: number,
    width: number,
    height: number,
    bytesPerPixel: number,
    stride: number,
  ): void;
  SetSourceResolution(ppi: number): void;
  Recognize(monitor: null): number;
  GetTSVText(): string;
  Clear(): void;
};

type TessCore = {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    unlink(path: string): void;
  };
  TessBaseAPI: new () => TessApi;
  _malloc(size: number): number;
  _free(pointer: number): void;
};

type CreateCore = (options: {
  instantiateWasm(
    imports: WebAssembly.Imports,
    accept: (
      instance: WebAssembly.Instance,
      module: WebAssembly.Module,
    ) => void,
  ): void;
}) => Promise<TessCore>;

const bytesPerPixel = 4;
const maxPixels = 4_194_304;
const lstmOnly = 1;
const pageSegmentation: Record<Mode, number> = { auto: 3, line: 7 };
const sourcePpi = 150;
let model:
  | Promise<{ core: TessCore; api: TessApi; memory: WebAssembly.Memory }>
  | undefined;

async function initialize() {
  const [wasm, weights] = await Promise.all([
    readFile(new URL("./tesseract.wasm", import.meta.url)),
    readFile(new URL("./eng.traineddata.gz", import.meta.url)),
  ]);
  const compiled = await WebAssembly.compile(wasm);
  const createCore: CreateCore = createRequire(import.meta.url)(
    "./tesseract.cjs",
  );
  let memory: WebAssembly.Memory | undefined;
  const core = await createCore({
    instantiateWasm(imports, accept) {
      const instance = new WebAssembly.Instance(compiled, imports);
      memory = Object.values(instance.exports).find(
        (value) => value instanceof WebAssembly.Memory,
      );
      accept(instance, compiled);
    },
  });
  if (!memory) throw new Error("OCR WASM did not export linear memory");
  const api = new core.TessBaseAPI();
  const modelFile = "/eng.traineddata";
  core.FS.writeFile(modelFile, gunzipSync(weights));
  try {
    if (api.Init("/", "eng", lstmOnly) !== 0) {
      throw new Error("Could not initialize bundled English OCR data");
    }
  } finally {
    core.FS.unlink(modelFile);
  }
  return { core, api, memory };
}

function readWords(tsv: string): Word[] {
  const words: Word[] = [];
  let previousLine = "";
  let line = -1;
  for (const row of tsv.split("\n")) {
    if (!row.startsWith("5\t")) continue;
    const [
      ,
      page,
      block,
      paragraph,
      textLine,
      ,
      x,
      y,
      width,
      height,
      confidence,
      ...tail
    ] = row.split("\t");
    const text = tail.join("\t").trim();
    if (!text) continue;
    const lineKey = `${page}/${block}/${paragraph}/${textLine}`;
    if (lineKey !== previousLine) {
      line++;
      previousLine = lineKey;
    }
    words.push({
      text,
      confidence: Number(confidence) / 100,
      line,
      box: {
        x: Number(x),
        y: Number(y),
        width: Number(width),
        height: Number(height),
      },
    });
  }
  return words;
}

export async function recognize(
  rgba: Uint8Array,
  width: number,
  height: number,
  mode: Mode = "auto",
): Promise<Word[]> {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 32_767 ||
    height > 32_767 ||
    width * height > maxPixels ||
    !(rgba instanceof Uint8Array) ||
    rgba.byteLength !== width * height * bytesPerPixel
  ) {
    throw new RangeError(
      "OCR requires tightly packed RGBA8 within 4,194,304 pixels and 32,767 pixels per side",
    );
  }
  if (mode !== "auto" && mode !== "line")
    throw new RangeError("Unknown OCR page segmentation mode");

  model ??= initialize().catch((error) => {
    model = undefined;
    throw error;
  });
  const { core, api, memory } = await model;
  try {
    const pointer = core._malloc(rgba.byteLength);
    if (!pointer) throw new Error("Could not allocate OCR image memory");
    try {
      new Uint8Array(memory.buffer, pointer, rgba.byteLength).set(rgba);
      api.SetPageSegMode(pageSegmentation[mode]);
      api.SetImage(
        pointer,
        width,
        height,
        bytesPerPixel,
        width * bytesPerPixel,
      );
      api.SetSourceResolution(sourcePpi);
      if (api.Recognize(null) !== 0) throw new Error("OCR inference failed");
      return readWords(api.GetTSVText());
    } finally {
      try {
        api.Clear();
      } finally {
        core._free(pointer);
      }
    }
  } catch (error) {
    if (error instanceof WebAssembly.RuntimeError) model = undefined;
    throw error;
  }
}
