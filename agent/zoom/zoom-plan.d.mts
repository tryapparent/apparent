export type Clock = { $: "Clock"; hi: number; lo: number };
export type Items<T> = { $: "Nil" } | { $: "Con"; head: T; tail: Items<T> };
declare const policy: {
  phrase_hit(
    words: Items<string>,
    segments: Items<string>,
    query: Items<string>,
    phrase: string,
  ): { word: boolean; index: number };
  before(a: Clock, b: Clock): boolean;
  zoom_window(
    mark: boolean,
    a: Clock,
    b: Clock,
    span: Clock,
    duration: Clock,
  ): { start: Clock; stop: Clock };
  cell_count(start: Clock, stop: Clock, requested: Clock): number;
  cell_time(start: Clock, stop: Clock, index: number, count: number): Clock;
  nearest_cell(frames: Items<Clock>, time: Clock): number;
};
export default policy;
