declare const policy: {
  valid_limit(limit: number): boolean;
  valid_recording_day(day: number): boolean;
};
export default policy;
