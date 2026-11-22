import { FaceLandmarker } from "@lip-runtime/vision_bundle.mjs";
import wasmLoader from "@lip-runtime/wasm/vision_wasm_internal.js?url";

type Point = { x: number; y: number };
const outerLips = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const innerLips = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];

export class LipPreview {
  private frame?: number;
  private time = -1;
  private stopped = false;
  private readonly motion: number[] = [];
  private readonly view: Window;
  private readonly carbon: string;
  private readonly lilac: string;

  private constructor(
    private readonly video: HTMLVideoElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly tracker: FaceLandmarker,
    private readonly onMotion: (levels: number[] | null) => void,
    private readonly onFailure: () => void,
    private readonly showUntracked: boolean,
  ) {
    this.view = canvas.ownerDocument.defaultView ?? window;
    const theme = this.view.getComputedStyle(canvas);
    this.carbon = theme.getPropertyValue("--apparent-carbon").trim() || "black";
    this.lilac = theme.getPropertyValue("--apparent-lilac").trim() || "lavender";
  }

  static async start(video: HTMLVideoElement, canvas: HTMLCanvasElement, model: Uint8Array, wasm: Uint8Array,
      signal: AbortSignal, onMotion: (levels: number[] | null) => void, onFailure: () => void, showUntracked = true) {
    const binary = URL.createObjectURL(new Blob([Uint8Array.from(wasm)], {type: "application/wasm"}));
    const tracker = await FaceLandmarker.createFromOptions({
      wasmLoaderPath: new URL(wasmLoader, document.baseURI).href,
      wasmBinaryPath: binary,
    }, { baseOptions: { modelAssetBuffer: model, delegate: "CPU" }, runningMode: "VIDEO", numFaces: 1 }).finally(() => URL.revokeObjectURL(binary));
    const preview = new LipPreview(video, canvas, tracker, onMotion, onFailure, showUntracked);
    if (signal.aborted) {
      preview.stop();
      return;
    }
    signal.addEventListener("abort", () => preview.stop(), { once: true });
    preview.enqueue();
  }

  private enqueue() {
    this.frame = this.view.requestAnimationFrame((time) => {
      if (this.stopped) return;
      try {
        if (this.video.readyState >= 2 && this.video.currentTime !== this.time) {
          this.time = this.video.currentTime;
          this.render(this.tracker.detectForVideo(this.video, time).faceLandmarks[0]);
        }
      } catch {
        this.stop();
        this.onFailure();
        return;
      }
      this.enqueue();
    });
  }

  private render(points: Point[] | undefined) {
    const context = this.canvas.getContext("2d");
    if (!context) return;
    const { width, height } = this.canvas;
    const { videoWidth, videoHeight } = this.video;
    context.save();
    context.translate(width, 0);
    context.scale(-1, 1);
    if (!points) {
      if (!this.showUntracked) {
        context.clearRect(0, 0, width, height);
        context.restore();
        this.motion.length = 0;
        this.onMotion(null);
        return;
      }
      const zoom = Math.min(width / videoWidth, height / videoHeight);
      const w = videoWidth * zoom;
      const h = videoHeight * zoom;
      context.fillStyle = this.carbon;
      context.fillRect(0, 0, width, height);
      context.globalAlpha = 0.45;
      context.drawImage(this.video, (width - w) / 2, (height - h) / 2, w, h);
      context.restore();
      this.motion.length = 0;
      this.onMotion(null);
      return;
    }

    const pixel = (index: number) => ({ x: points[index].x * videoWidth, y: points[index].y * videoHeight });
    const outline = outerLips.map(pixel);
    const xs = outline.map(p => p.x);
    const ys = outline.map(p => p.y);
    const left = Math.min(...xs), right = Math.max(...xs);
    const top = Math.min(...ys), bottom = Math.max(...ys);
    const scale = Math.min((width - 30) / Math.max(10, right - left), (height - 16) / Math.max(6, bottom - top));
    const x = (width - (left + right) * scale) / 2;
    const y = (height - (top + bottom) * scale) / 2;
    context.fillStyle = this.carbon;
    context.fillRect(0, 0, width, height);
    context.drawImage(this.video, x, y, videoWidth * scale, videoHeight * scale);
    context.lineWidth = 1;
    context.strokeStyle = context.fillStyle = this.lilac;
    for (const contour of [outline, innerLips.map(pixel)]) {
      context.beginPath();
      for (const p of contour) context.lineTo(p.x * scale + x, p.y * scale + y);
      context.closePath();
      context.stroke();
      for (const p of contour) {
        context.beginPath();
        context.arc(p.x * scale + x, p.y * scale + y, 1.1, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
    const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
    const level = Math.min(1, 2.6 * distance(pixel(13), pixel(14)) / Math.max(1, distance(pixel(61), pixel(291))));
    this.motion.push(level);
    if (this.motion.length > 10) this.motion.shift();
    this.onMotion([...this.motion]);
  }

  private stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame);
    this.tracker.close();
  }
}
