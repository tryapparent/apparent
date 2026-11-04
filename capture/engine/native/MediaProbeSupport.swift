@preconcurrency import AVFoundation
import Foundation

/// Media primitives shared by the independent Engine probe and the existing Desktop export.
enum MediaProbeSupport {
  /// A track's timeRange can include empty edit-list padding before its media.
  /// Admission and export must find an actual, nonempty media segment.
  static func audioTrackOverlaps(_ track: AVAssetTrack, start: Double, end: Double) async throws -> Bool {
    for segment in try await track.load(.segments) where !segment.isEmpty {
      let range = segment.timeMapping.target
      let first = range.start.seconds
      let last = CMTimeRangeGetEnd(range).seconds
      if first.isFinite && last.isFinite && first < end && last > start && last > first {
        return true
      }
    }
    return false
  }
}
