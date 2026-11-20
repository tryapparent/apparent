declare const policy: {
  clip_seconds(): number;
  admit(enabled: boolean, prepared: boolean): boolean;
  valid_size(size: number): boolean;
};
export default policy;
