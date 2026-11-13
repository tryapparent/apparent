import AVFoundation
import Foundation

// Native facts only: callers decide audio selection and export policy. Keep
// actual edit-list segments, rather than treating empty padding as audio.
@main
struct Probe {
  static func number(_ value: Double) throws -> String {
    guard value.isFinite else { throw NSError(domain: "Engine", code: 1) }
    return String(format: "%.9f", locale: Locale(identifier: "en_US_POSIX"), value)
  }

  static func inspect(_ path: String) async throws -> [String: Any] {
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))
    let duration = try await asset.load(.duration).seconds
    var streams: [[String: Any]] = []
    for (index, track) in try await asset.load(.tracks).enumerated() {
      let type = track.mediaType
      guard type == .video || type == .audio else { continue }
      let range = try await track.load(.timeRange)
      var item: [String: Any] = [
        "index": index, "codec_type": type == .video ? "video" : "audio",
        "start_time": try number(range.start.seconds),
        "duration": try number(range.duration.seconds)
      ]
      if type == .video {
        let (size, transform, rate) = try await track.load(.naturalSize, .preferredTransform, .nominalFrameRate)
        let shown = size.applying(transform)
        item["width"] = Int(abs(shown.width).rounded())
        item["height"] = Int(abs(shown.height).rounded())
        item["avg_frame_rate"] = try number(Double(rate)) + "/1"
      } else {
        var segments: [[String: String]] = []
        for segment in try await track.load(.segments) where !segment.isEmpty {
          let target = segment.timeMapping.target
          segments.append(["start_time": try number(target.start.seconds),
                           "duration": try number(target.duration.seconds)])
        }
        item["segments"] = segments
      }
      streams.append(item)
    }
    return ["format": ["duration": try number(duration)], "streams": streams]
  }

  static func main() async {
    do {
      guard CommandLine.arguments.count == 2 else { throw NSError(domain: "Engine", code: 2) }
      let result = try await inspect(CommandLine.arguments[1])
      let bytes = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
      FileHandle.standardOutput.write(bytes + Data([10]))
    } catch {
      FileHandle.standardError.write(Data("Engine could not inspect the local movie\n".utf8))
      exit(1)
    }
  }
}
