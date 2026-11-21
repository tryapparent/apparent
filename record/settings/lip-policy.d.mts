declare const policy: {
  clip_seconds(): number;
  finish_tail_ms(): number;
  admit(enabled: boolean, prepared: boolean): boolean;
  valid_size(size: number): boolean;
  setup_state(enabled: boolean, existing: boolean, supported: boolean): 0 | 1 | 2 | 3;
};
export default policy;
