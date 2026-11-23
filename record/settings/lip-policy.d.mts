declare const policy: {
  clip_seconds(): number;
  decode_threads(): number;
  use_microphone(lips: boolean, microphone: boolean): boolean;
  queue_clip(pending: number): boolean;
  finish_tail_ms(): number;
  admit(enabled: boolean, prepared: boolean): boolean;
  valid_size(size: number): boolean;
  setup_state(enabled: boolean, existing: boolean, supported: boolean): 0 | 1 | 2 | 3;
};
export default policy;
