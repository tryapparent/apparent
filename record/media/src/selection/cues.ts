/** Record's pointing-word priorities. Estimated word timings are not cues. */
export interface SpeechCue {index: number; cue: string; score: number; strong: boolean}

const priorities: ReadonlyMap<string, readonly [number, boolean]> = new Map([
  ['now', [58, true]], ['here', [56, true]], ['look', [58, true]], ['watch', [58, true]],
  ['see', [44, false]], ['there', [44, false]], ['this', [44, false]], ['these', [44, false]],
  ['that', [42, false]], ['those', [42, false]],
]);

export function speechCues(estimated: boolean, words: readonly string[]): SpeechCue[] {
  if (typeof estimated !== 'boolean' || !Array.isArray(words)
    || words.some(word => typeof word !== 'string')) throw Error('Invalid speech input');
  if (estimated) return [];
  const cues: SpeechCue[] = [];
  words.forEach((word, index) => {
    const cue = word.replace(/^[^\p{Alphabetic}\p{Number}]+|[^\p{Alphabetic}\p{Number}]+$/gu, '').toLowerCase();
    const priority = priorities.get(cue);
    if (priority) cues.push({index, cue, score: priority[0], strong: priority[1]});
  });
  return cues;
}
