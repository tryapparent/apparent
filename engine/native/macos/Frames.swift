import AVFoundation
import CoreGraphics
import CoreMedia
import Darwin
import Foundation

// Native execution, not sampling policy. The caller supplies exact movie times.
// A precise sample cursor selects the last presentation sample at/before a
// request (or the first sample). ImageGenerator then decodes that exact sample.
private enum Failure: Error, Equatable { case invalidRequest, unsafeOutput, decodeFailed, resourceLimit, writeFailed }
private struct Frame: Codable, Sendable {
  let requestIndex: Int
  let requestedMs: Int64
  let actualMs: Int64
  let width: Int
  let height: Int
  let file: String
}
private struct Reply: Codable { let version: Int; let frames: [Frame] }

private actor Output {
  let fd: Int32
  var pixels: Int64 = 0
  init(_ fd: Int32) { self.fd = fd }

  func write(_ image: CGImage, index: Int, requested: Int64, actual: Int64) throws -> Frame {
    let width = image.width, height = image.height
    guard width > 0, height > 0, width <= 16384, height <= 16384 else { throw Failure.resourceLimit }
    let count = Int64(width) * Int64(height)
    guard count <= 64 * 1024 * 1024, pixels + count <= 256 * 1024 * 1024 else {
      throw Failure.resourceLimit
    }
    var bytes = Data(count: Int(count) * 4)
    let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
      guard let context = CGContext(data: buffer.baseAddress, width: width, height: height,
        bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
      context.interpolationQuality = .high
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      // Public RGBA8 uses straight alpha; CoreGraphics draws premultiplied bytes.
      let pixels = buffer.bindMemory(to: UInt8.self)
      for index in stride(from: 0, to: pixels.count, by: 4) {
        let alpha = Int(pixels[index + 3])
        if alpha == 0 {
          pixels[index] = 0; pixels[index + 1] = 0; pixels[index + 2] = 0
        } else if alpha < 255 {
          for channel in 0..<3 {
            pixels[index + channel] = UInt8(min(255, (Int(pixels[index + channel]) * 255 + alpha / 2) / alpha))
          }
        }
      }
      return true
    }
    guard drawn else { throw Failure.decodeFailed }
    let name = String(format: "frame-%03d.rgba", index)
    let file = name.withCString { openat(fd, $0, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600) }
    guard file >= 0 else { throw Failure.writeFailed }
    let handle = FileHandle(fileDescriptor: file, closeOnDealloc: true)
    defer { try? handle.close() }
    guard fchmod(file, 0o600) == 0 else { throw Failure.writeFailed }
    try handle.write(contentsOf: bytes)
    pixels += count
    return Frame(requestIndex: index, requestedMs: requested, actualMs: actual,
                 width: width, height: height, file: name)
  }
}

@main
struct Frames {
  private static func decode(_ movie: String, fd: Int32, edge: Int, times: [Int64]) async throws -> [Frame] {
    var metadata = stat()
    guard fstat(fd, &metadata) == 0, metadata.st_mode & S_IFMT == S_IFDIR,
          metadata.st_uid == geteuid(), metadata.st_mode & 0o777 == 0o700 else { throw Failure.unsafeOutput }
    let descriptorFlags = fcntl(fd, F_GETFD)
    guard descriptorFlags >= 0, fcntl(fd, F_SETFD, descriptorFlags | FD_CLOEXEC) == 0 else { throw Failure.unsafeOutput }
    let asset = AVURLAsset(url: URL(fileURLWithPath: movie),
      options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    guard try await asset.load(.providesPreciseDurationAndTiming),
          let track = try await asset.loadTracks(withMediaType: .video).first else { throw Failure.decodeFailed }
    let mappings = try await track.load(.segments).filter { !$0.isEmpty }.map(\.timeMapping)
      .sorted { CMTimeCompare($0.target.start, $1.target.start) < 0 }
    guard !mappings.isEmpty else { throw Failure.decodeFailed }
    let output = Output(fd)
    let workers = min(6, times.count)
    let chunk = (times.count + workers - 1) / workers
    let frames = try await withThrowingTaskGroup(of: [Frame].self) { group in
      for start in stride(from: 0, to: times.count, by: chunk) {
        let end = min(times.count, start + chunk)
        group.addTask {
          let generator = AVAssetImageGenerator(asset: asset)
          generator.appliesPreferredTrackTransform = true
          generator.requestedTimeToleranceBefore = .zero
          generator.requestedTimeToleranceAfter = .zero
          if edge > 0 { generator.maximumSize = CGSize(width: edge, height: edge) }
          var result: [Frame] = []
          for index in start..<end {
            let requested = CMTime(value: times[index], timescale: 1000)
            let mapping = mappings.last { CMTimeCompare($0.target.start, requested) <= 0 } ?? mappings[0]
            let clamped = CMTimeMinimum(CMTimeMaximum(requested, mapping.target.start), mapping.target.end)
            // Cursors use sample/media time; image generation uses the edited
            // movie timeline. Keep leading gaps and edit-list offsets explicit.
            let media = CMTimeMapTimeFromRangeToRange(clamped, fromRange: mapping.target, toRange: mapping.source)
            guard media.seconds.isFinite, let cursor = track.makeSampleCursor(presentationTimeStamp: media) else {
              throw Failure.decodeFailed
            }
            var steps = 0
            while CMTimeCompare(cursor.presentationTimeStamp, mapping.source.end) >= 0 {
              guard steps < 1024, cursor.stepInPresentationOrder(byCount: -1) != 0 else { throw Failure.decodeFailed }
              steps += 1
            }
            let sample = CMTimeMaximum(mapping.target.start,
              CMTimeMapTimeFromRangeToRange(cursor.presentationTimeStamp, fromRange: mapping.source, toRange: mapping.target))
            guard sample.seconds.isFinite else { throw Failure.decodeFailed }
            let (image, actual) = try await generator.image(at: sample)
            guard CMTimeCompare(actual, sample) == 0 else { throw Failure.decodeFailed }
            let milliseconds = CMTimeConvertScale(sample, timescale: 1000, method: .roundTowardNegativeInfinity).value
            guard milliseconds >= -9_007_199_254_740_991, milliseconds <= 9_007_199_254_740_991 else {
              throw Failure.decodeFailed
            }
            result.append(try await output.write(image, index: index, requested: times[index], actual: milliseconds))
          }
          return result
        }
      }
      var result: [Frame] = []
      for try await groupResult in group { result.append(contentsOf: groupResult) }
      return result
    }
    return frames.sorted { $0.requestIndex < $1.requestIndex }
  }

  static func main() async {
    do {
      let args = CommandLine.arguments
      guard args.count == 5, args[1].hasPrefix("/"), let fd = Int32(args[2]),
            let edge = Int(args[3]), edge >= 0, edge <= 16384 else { throw Failure.invalidRequest }
      let times = try args[4].split(separator: ",", omittingEmptySubsequences: false).map { value -> Int64 in
        guard let n = Int64(value), n >= 0, n <= 9_007_199_254_740_991 else { throw Failure.invalidRequest }
        return n
      }
      guard !times.isEmpty, times.count <= 48 else { throw Failure.invalidRequest }
      let frames = try await decode(args[1], fd: fd, edge: edge, times: times)
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
      FileHandle.standardOutput.write(try encoder.encode(Reply(version: 1, frames: frames)) + Data([10]))
    } catch {
      FileHandle.standardError.write(Data("Engine could not decode the local movie\n".utf8))
      if let failure = error as? Failure, failure == .resourceLimit { exit(72) }
      exit(1)
    }
  }
}
