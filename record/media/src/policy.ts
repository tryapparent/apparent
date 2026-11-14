import type {MovieInfo, TrackTiming} from '@apparent/engine-sdk';

export interface ExportProbe {
  version: 1;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  audioTracks: number;
  embeddedAudio: number | null;
}

export interface BundleProbe {
  version: 1;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  audioTracks: number;
}

/** Assembly/recovery preserve the container clock, including a longer audio
 * tail. Audio track presence is metadata, never proof that decoding succeeded.
 * A missing container clock may use the video clock; an explicitly empty one
 * is not silently replaced by another timeline. */
export function bundleProbe(info: MovieInfo): BundleProbe {
  const video = info.video;
  const durationMs = info.durationMs ?? video?.durationMs;
  if (!video || !durationMs || durationMs < 0 || !video.width || !video.height)
    throw new Error('The recording has no video');
  return {version: 1, durationMs, width: video.width, height: video.height,
    fps: video.fps ?? 0, audioTracks: info.audio.length};
}

/** Export follows the video clock, including when container audio has a tail.
 * Missing segment detail uses the track interval; an empty segment list means
 * the native provider found no actual audio edits. This policy is shared by both OSes.
 */
export function exportProbe(info: MovieInfo): ExportProbe {
  const video = info.video;
  const durationMs = video?.durationMs ?? info.durationMs;
  if (!video || !durationMs || durationMs < 0 || !video.width || !video.height)
    throw new Error('The recording has no video');
  const overlaps = (range: TrackTiming) => {
    const start = range.startMs ?? 0;
    const duration = range.durationMs ?? 0;
    return duration > 0 && start < durationMs && start + duration > 0;
  };
  const audio = info.audio.filter(track => track.segments === null
    ? overlaps(track) : track.segments.some(overlaps));
  return {version: 1, durationMs, width: video.width, height: video.height,
    fps: video.fps ?? 0, audioTracks: audio.length, embeddedAudio: audio[0]?.streamIndex ?? null};
}
