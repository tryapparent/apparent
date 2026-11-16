/** Record's clause-aware partition of transcript text across selected keyframes. */
export interface TimedText {t0: bigint; t1: bigint; text: string}
export interface TranscriptText {
  text: string;
  words: readonly TimedText[];
  segments: readonly TimedText[];
}

const U64_MAX = 0xffff_ffff_ffff_ffffn;
const trim = (text: string) => text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
const wordCount = (text: string) => Math.max(1, text.split(/\p{White_Space}+/u)
  .filter(word => /[\p{Alphabetic}\p{Number}]/u.test(word)).length);
const endsClause = (text: string, count: number) => {
  const end = text.replace(/["'”’)\]]+$/u, '');
  return /[.!?;:]$/u.test(end) || (count >= 3 && end.endsWith(','));
};
function time(value: bigint) {
  if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) throw Error('Invalid transcript time');
}

export function alignTranscript(
  times: readonly bigint[], anchors: readonly bigint[], transcript: TranscriptText,
): Array<string | null> {
  times.forEach(time); anchors.forEach(time);
  if (!times.length) return [];
  for (const unit of [...transcript.words, ...transcript.segments]) { time(unit.t0); time(unit.t1); }
  const units = [...(transcript.words.length ? transcript.words : transcript.segments)]
    .filter(unit => trim(unit.text).length).sort((a, b) => a.t0 < b.t0 ? -1 : a.t0 > b.t0 ? 1 : 0);
  const segmentStarts = transcript.segments.map(segment => segment.t0)
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const startsSegment = (t: bigint) => {
    let lo = 0, hi = segmentStarts.length;
    const first = t > 20n ? t - 20n : 0n;
    while (lo < hi) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (segmentStarts[mid] < first) lo = mid + 1; else hi = mid;
    }
    return lo < segmentStarts.length && segmentStarts[lo] <= t + 20n;
  };
  const clauses: Array<{start: bigint; end: bigint}> = [];
  let previous: TimedText | undefined, clauseWords = 0;
  for (const unit of units) {
    const newClause = !previous || endsClause(previous.text, clauseWords)
      || unit.t0 - previous.t1 >= 1500n || startsSegment(unit.t0);
    const clause = clauses.at(-1);
    if (clause && !newClause) {
      if (unit.t1 > clause.end) clause.end = unit.t1;
      clauseWords += wordCount(unit.text);
    } else {
      clauses.push({start: unit.t0, end: unit.t1});
      clauseWords = wordCount(unit.text);
    }
    previous = unit;
  }
  const starts: bigint[] = [];
  times.forEach((t, index) => {
    const anchor = anchors[index] ?? t;
    let start = clauses.find(clause => clause.start <= anchor && anchor <= clause.end)?.start ?? anchor;
    const prior = starts.at(-1);
    if (prior !== undefined && start <= prior) start = anchor > prior ? anchor : prior + 1n;
    starts.push(start);
  });
  const text = times.map(() => '');
  for (const unit of units) {
    const value = trim(unit.text);
    const near = unit.t0 > U64_MAX - 50n ? U64_MAX : unit.t0 + 50n;
    let index = starts.length - 1;
    while (index >= 0 && starts[index] > near) index--;
    if (index < 0) index = 0;
    const attached = /^[,.!?;:’')\]”]/u.test(value);
    if (attached && !text[index].length && index > 0) index--;
    if (text[index].length && !attached && !/[(\[“]$/u.test(text[index])) text[index] += ' ';
    text[index] += value;
  }
  if (text.every(value => !value.length) && trim(transcript.text).length) text[0] = trim(transcript.text);
  return text.map(value => value.length ? value : null);
}
