declare const policy: {
  clip_valid(from: number, to: number, duration: number): boolean;
  still_valid(at: number, duration: number): boolean;
  frames_for_ms(ms: number): number;
  scene_frames(visualMs: number, speechFrames: number, holdMs: number): number;
  caption_end(start: number, speechMs: number): number;
  sample_time(from: number, span: number, index: number, count: number): number;
  axis_fits(start: number, size: number, limit: number): boolean;
};

export default policy;
