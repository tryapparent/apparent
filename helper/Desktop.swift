@preconcurrency import AVFoundation
import Foundation
import CoreGraphics

// Platform adapter only: Rust owns inventory, geometry, shared clock and failure cutoffs.
private struct DesktopPlan: Decodable {
  struct Frame: Decodable { var x: Double; var y: Double; var width: Double; var height: Double }
  struct Display: Decodable { var frame: Frame; var failedMs: UInt64? }
  struct Source: Decodable { var path: String; var display: Display; var offsetMs: UInt64 }
  var width: Int; var height: Int; var frame: Frame; var durationMs: UInt64
  var sources: [Source]; var output: String
}

enum DesktopMovie {
  static func run(plan url: URL) async throws {
    let plan = try JSONDecoder().decode(DesktopPlan.self, from: Data(contentsOf: url))
    guard plan.width > 0, plan.height > 0, plan.frame.width > 0, plan.frame.height > 0,
          plan.durationMs > 0, !plan.sources.isEmpty,
          !FileManager.default.fileExists(atPath: plan.output) else {
      throw NSError(domain: "DesktopMovie", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid desktop plan or output already exists"])
    }
    func time(_ ms: UInt64) -> CMTime { CMTime(value: Int64(clamping: ms), timescale: 1000) }
    let duration = time(plan.durationMs)
    let composition = AVMutableComposition()
    var layers: [AVMutableVideoCompositionLayerInstruction] = []
    for source in plan.sources {
      let end = min(source.display.failedMs ?? plan.durationMs, plan.durationMs)
      guard end > source.offsetMs else { continue }
      let asset = AVURLAsset(url: URL(filePath: source.path))
      guard let video = try await asset.loadTracks(withMediaType: .video).first,
            let track = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
        throw NSError(domain: "DesktopMovie", code: 2, userInfo: [NSLocalizedDescriptionKey: "Display movie has no video track"])
      }
      let available = try await asset.load(.duration)
      let clip = CMTimeMinimum(available, time(end - source.offsetMs))
      guard clip.isNumeric, CMTimeCompare(clip, .zero) > 0 else { continue }
      // Keep the entire common timeline, including neutral space before/after this source.
      track.insertEmptyTimeRange(CMTimeRange(start: .zero, duration: duration))
      let destination = time(source.offsetMs)
      track.removeTimeRange(CMTimeRange(start: destination, duration: clip))
      try track.insertTimeRange(CMTimeRange(start: .zero, duration: clip), of: video, at: destination)
      let size = try await video.load(.naturalSize)
      let preferred = try await video.load(.preferredTransform)
      let oriented = CGRect(origin: .zero, size: size).applying(preferred)
      guard oriented.width > 0, oriented.height > 0 else {
        throw NSError(domain: "DesktopMovie", code: 3, userInfo: [NSLocalizedDescriptionKey: "Invalid display movie geometry"])
      }
      let sx = Double(plan.width) / plan.frame.width
      let sy = Double(plan.height) / plan.frame.height
      let frame = source.display.frame
      let transform = preferred
        .concatenating(CGAffineTransform(translationX: -oriented.minX, y: -oriented.minY))
        .concatenating(CGAffineTransform(scaleX: frame.width * sx / oriented.width, y: frame.height * sy / oriented.height))
        .concatenating(CGAffineTransform(translationX: (frame.x - plan.frame.x) * sx, y: (frame.y - plan.frame.y) * sy))
      let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
      layer.setTransform(transform, at: .zero)
      layer.setOpacity(0, at: CMTimeAdd(destination, clip))
      layers.append(layer)
    }
    guard !layers.isEmpty else {
      throw NSError(domain: "DesktopMovie", code: 4, userInfo: [NSLocalizedDescriptionKey: "No usable display movies"])
    }
    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
    instruction.backgroundColor = CGColor(gray: 0.09, alpha: 1)
    instruction.layerInstructions = layers
    let videoComposition = AVMutableVideoComposition()
    videoComposition.renderSize = CGSize(width: plan.width, height: plan.height)
    videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
    videoComposition.instructions = [instruction]
    guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
      throw NSError(domain: "DesktopMovie", code: 5, userInfo: [NSLocalizedDescriptionKey: "Desktop encoder unavailable"])
    }
    exporter.videoComposition = videoComposition
    exporter.timeRange = CMTimeRange(start: .zero, duration: duration)
    exporter.shouldOptimizeForNetworkUse = true
    try await exporter.export(to: URL(filePath: plan.output), as: .mp4)
    emit(["ok": true])
  }
}
