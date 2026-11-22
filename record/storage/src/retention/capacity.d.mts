export type Bytes = {$: 'Bytes'; hi: number; lo: number};
declare const capacity: {
  below(left: Bytes, right: Bytes): boolean;
  choose(used: Bytes, limit: Bytes, age: Bytes, unchanged: Bytes, size: Bytes): {$: 'Choice'; trash: boolean; remaining: Bytes};
  constrain(maximumMb: number): boolean;
  warn(hasSaved: boolean, saved: number, next: number): boolean;
};
export default capacity;
