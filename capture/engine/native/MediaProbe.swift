@preconcurrency import AVFoundation
import Foundation

/// `apparent-engine-media probe MOVIE` is Engine's read-only QuickTime metadata operation.
/// It deliberately has no dependency on the Desktop helper, UI frameworks or app policy.
enum MediaProbe {
  static func inspect(_ movie: URL) async throws -> [String: Any] {
    let asset = AVURLAsset(url: movie)
    let duration = try await asset.load(.duration).seconds
    var result: [String: Any] = ["durationMs": Int(((duration.isFinite ? duration : 0) * 1000).rounded())]
    var videoDuration = duration
    if let track = try await asset.loadTracks(withMediaType: .video).first {
      let (size, transform) = try await track.load(.naturalSize, .preferredTransform)
      let shown = size.applying(transform)
      result["width"] = Int(abs(shown.width).rounded())
      result["height"] = Int(abs(shown.height).rounded())
      result["fps"] = Double(try await track.load(.nominalFrameRate))
      let range = try await track.load(.timeRange)
      videoDuration = range.duration.seconds
      if videoDuration.isFinite && videoDuration > 0 {
        result["videoDurationMs"] = Int((videoDuration * 1000).rounded())
      }
    }
    let audioTracks = try await asset.loadTracks(withMediaType: .audio)
    result["audioTracks"] = audioTracks.count
    var audioOverlapsVideo = false
    for track in audioTracks {
      if try await MediaProbeSupport.audioTrackOverlaps(track, start: 0, end: videoDuration) {
        audioOverlapsVideo = true
      }
    }
    result["audioOverlapsVideo"] = audioOverlapsVideo
    return result
  }

}

@main
struct EngineMediaCommand {
  static func main() async {
    let arguments = Array(CommandLine.arguments.dropFirst())
    guard arguments.count == 2, arguments[0] == "probe" else {
      fail("usage: apparent-engine-media probe MOVIE")
    }
    do {
      let result = try await MediaProbe.inspect(URL(fileURLWithPath: arguments[1]))
      let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys, .withoutEscapingSlashes])
      FileHandle.standardOutput.write(data + Data("\n".utf8))
    } catch {
      fail(error.localizedDescription)
    }
  }

  private static func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("apparent-helper: \(message)\n".utf8))
    exit(1)
  }
}
