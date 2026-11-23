declare const policy: {
  family(index: number): number;
  category(
    group: number,
    combined: number,
    top: number,
    generic: boolean,
  ): number;
  word_admission(hits: number, confidence: number): number;
  retry_region(hasText: boolean, hasCategory: boolean, wide: boolean): number;
  include_category(hasText: boolean, wide: boolean, lines: number): boolean;
};
export default policy;
