declare const feedback: {
  submission_phase(
    submitted: boolean,
    busy: boolean,
    reading: boolean,
  ): 0 | 1 | 2 | 3;
  reset_available(custom: boolean, defaultsKnown: boolean): boolean;
  keep_submission(submitted: boolean, confirmed: boolean): boolean;
};
export default feedback;
