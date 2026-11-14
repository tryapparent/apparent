import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMovieInfo} from '@apparent/engine-sdk';
import {exportProbe} from '../src/policy.ts';

// Native FFprobe wire shape, through the actual published SDK parser. Provider
// execution and packaged caller acceptance are separate integration checks.
const movie = (audio: unknown[] = [], video: object = {}) => parseMovieInfo(JSON.stringify({
  format: {duration: '12.0'}, streams: [
    {index: 0, codec_type: 'video', width: 64, height: 48, duration: '1.0', start_time: '0.0', avg_frame_rate: '25/1', ...video},
    ...audio,
  ],
}));
test('export uses the video duration rather than the container audio tail', () => {
  assert.equal(exportProbe(movie()).durationMs, 1000);
  assert.equal(exportProbe(movie([], {duration: undefined})).durationMs, 12000);
});
test('only actual overlapping audio can be selected; provider stream IDs survive filtering', () => {
  const result = exportProbe(movie([
    {index: 2, codec_type: 'audio', start_time: '2.0', duration: '1.0'},
    {index: 7, codec_type: 'audio', start_time: '-0.2', duration: '1.0'},
    {index: 9, codec_type: 'audio', start_time: '0', duration: '1.0'},
  ]));
  assert.equal(result.audioTracks, 2);
  assert.equal(result.embeddedAudio, 7);
});
test('nonempty Mac edits, not padded track duration, determine usable audio', () => {
  const padded = {index: 3, codec_type: 'audio', start_time: '0', duration: '12.0'};
  assert.equal(exportProbe(movie([{...padded, segments: []}])).audioTracks, 0);
  assert.equal(exportProbe(movie([{...padded, segments: [{start_time: '5.0', duration: '1.0'}]}])).audioTracks, 0);
  assert.equal(exportProbe(movie([{...padded, segments: [{start_time: '0.5', duration: '0.1'}]}])).embeddedAudio, 3);
});
test('silent or unknown-length audio never becomes permission to select a track', () => {
  assert.equal(exportProbe(movie()).embeddedAudio, null);
  assert.equal(exportProbe(movie([{index: 1, codec_type: 'audio'}])).audioTracks, 0);
});
test('empty video is rejected and display bounds come from the SDK', () => {
  assert.throws(() => exportProbe(movie([], {duration: '0'})), /no video/);
  assert.throws(() => exportProbe(movie([], {width: 0})), /no video/);
  assert.deepEqual(exportProbe(movie([], {displayTransform: [0, 1, -1, 0]})), {
    version: 1, durationMs: 1000, width: 48, height: 64, fps: 25, audioTracks: 0, embeddedAudio: null,
  });
});
