declare module "@lip-runtime/vision_bundle.mjs" {
  export class FaceLandmarker {
    static createFromOptions(
      files: { wasmLoaderPath: string; wasmBinaryPath: string },
      options: {
        baseOptions: { modelAssetBuffer: Uint8Array; delegate: "CPU" };
        runningMode: "VIDEO";
        numFaces: number;
      },
    ): Promise<FaceLandmarker>;
    detectForVideo(video: HTMLVideoElement, timestamp: number): { faceLandmarks: { x: number; y: number }[][] };
    close(): void;
  }
}
