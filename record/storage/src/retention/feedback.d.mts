declare const feedback: {
  submission_phase(
    submitted: boolean,
    busy: boolean,
    reading: boolean,
  ): 0 | 1 | 2 | 3;
  reset_available(custom: boolean, defaultsKnown: boolean): boolean;
  keep_submission(submitted: boolean, confirmed: boolean): boolean;
  show_readback_difference(
    reading: boolean,
    submitted: boolean,
    confirmed: boolean,
    mediaMatches: boolean,
    captureMatches: boolean,
  ): boolean;
  has_draft(selected: boolean, matchesSaved: boolean): boolean;
};
export default feedback;
