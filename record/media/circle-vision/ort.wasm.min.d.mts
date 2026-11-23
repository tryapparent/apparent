export const env: {
  wasm: {
    numThreads: number;
    proxy: boolean;
    wasmBinary: Uint8Array;
    wasmPaths: { mjs: string };
  };
};
export class Tensor {
  constructor(type: "float32", data: Float32Array, shape: number[]);
  data: Float32Array;
  dispose(): void;
}
export const InferenceSession: {
  create(
    model: Uint8Array,
    options: { executionProviders: string[] },
  ): Promise<{
    outputNames: string[];
    inputNames: string[];
    run(inputs: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  }>;
};
