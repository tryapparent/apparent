declare const policy: {
  capture_occupied(available: boolean, phase: string): boolean;
  may_confirm(phase: string, availability: string): boolean;
};
export default policy;
