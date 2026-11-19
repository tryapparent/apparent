declare const policy: {
  volume_switch_enabled(available: boolean, saved: boolean): boolean;
  volume_level_enabled(available: boolean, saved: boolean): boolean;
  transcription_detail(
    command: boolean,
    hex: boolean,
    hexAvailable: boolean,
  ): 0 | 1 | 2;
};
export default policy;
