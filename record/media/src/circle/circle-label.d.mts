declare const policy: {
  family(index: number): number;
  category(
    group: number,
    combined: number,
    top: number,
    generic: boolean,
  ): number;
  word_admission(hits: number, confidence: number, complete: boolean): number;
  select_line(
    uncertain: boolean,
    centeredX: boolean,
    centeredY: boolean,
    hasCategory: boolean,
  ): boolean;
  retry_region(
    hasText: boolean,
    uncertain: boolean,
    hasCategory: boolean,
    wide: boolean,
  ): number;
  include_caption(hasCategory: boolean, lines: number): boolean;
};
export default policy;
