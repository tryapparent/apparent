declare const policy: {
  volume_level_disabled(pending: boolean, saved: boolean): boolean;
  transcription_detail(
    command: boolean,
    hex: boolean,
    hexAvailable: boolean,
  ): 0 | 1 | 2;
};
export default policy;
