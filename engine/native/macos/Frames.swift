import AVFoundation
import CoreGraphics
import CoreImage
import CoreMedia
import CoreVideo
import Darwin
import Foundation

// Native execution, not sampling policy. The caller supplies exact movie times.
// A precise sample cursor selects the last presentation sample at/before a
// request (or the first sample). ImageGenerator then decodes that exact sample.
private enum Failure: String, Error, Equatable {
  case invalidRequest, unsafeOutput, decodeFailed, resourceLimit, writeFailed
  case preciseTiming, videoTrack, segments, mediaTime, cursor, cursorRange, sampleTime, generatorTime, rgbaContext
  case sequentialReader, sequentialTime, sequentialImage
}
private struct Frame: Codable, Sendable {
  let requestIndex: Int
  let requestedMs: Int64
  let actualMs: Int64
  let width: Int
  let height: Int
  let file: String
}
private struct Reply: Codable { let version: Int; let frames: [Frame] }

// Random seeking into an open GOP can omit reference pictures. On a native
// decode failure, read from the beginning in presentation order instead. Keep
// this rare path serial and retain no movie-sized frame cache.
private actor SequentialFrames {
  let asset: AVAsset
  let track: AVAssetTrack
  let transform: CGAffineTransform
  lazy var context = CIContext(options: [.cacheIntermediates: false])
  init(asset: AVAsset, track: AVAssetTrack, transform: CGAffineTransform) {
    self.asset = asset; self.track = track; self.transform = transform
  }

  func image(at target: CMTime, edge: Int) throws -> CGImage {
    let reader = try AVAssetReader(asset: asset)
    defer { reader.cancelReading() }
    let output = AVAssetReaderTrackOutput(track: track,
      outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else { throw Failure.sequentialReader }
    reader.add(output)
    guard reader.startReading() else { throw readerFailure(reader) }
    var previous: CMTime?
    while let sample = output.copyNextSampleBuffer() {
      try Task.checkCancellation()
      let time = CMSampleBufferGetOutputPresentationTimeStamp(sample)
      guard time.seconds.isFinite,
            previous.map({ CMTimeCompare(time, $0) >= 0 }) ?? true else { throw Failure.sequentialTime }
      previous = time
      if CMTimeCompare(time, target) < 0 { continue }
      guard CMTimeCompare(time, target) == 0 else {
        FileHandle.standardError.write(Data("Engine frame timing: sample=\(target.value)/\(target.timescale) actual=\(time.value)/\(time.timescale) request=\(CMTimeConvertScale(target, timescale: 1000, method: .roundTowardNegativeInfinity).value)\n".utf8))
        throw Failure.sequentialTime
      }
      guard let buffer = CMSampleBufferGetImageBuffer(sample) else { throw Failure.sequentialImage }
      let rawWidth = CVPixelBufferGetWidth(buffer), rawHeight = CVPixelBufferGetHeight(buffer)
      guard rawWidth > 0, rawHeight > 0, rawWidth <= 16384, rawHeight <= 16384,
            Int64(rawWidth) * Int64(rawHeight) <= 64 * 1024 * 1024 else { throw Failure.resourceLimit }
      // Video transforms use a downward Y axis; Core Image uses an upward Y
      // axis. Change basis on both sides (F * T * F). Normalizing the resulting
      // extent below removes the origin translations without reversing rotation.
      let flip = CGAffineTransform(scaleX: 1, y: -1)
      let image = CIImage(cvPixelBuffer: buffer).transformed(by: flip)
        .transformed(by: transform).transformed(by: flip)
      let bounds = image.extent
      guard bounds.minX.isFinite, bounds.minY.isFinite, bounds.width.isFinite, bounds.height.isFinite,
            bounds.width > 0, bounds.height > 0 else { throw Failure.sequentialImage }
      let scale = edge > 0 ? min(1, CGFloat(edge) / max(bounds.width, bounds.height)) : 1
      let width = max(1, (bounds.width * scale).rounded()), height = max(1, (bounds.height * scale).rounded())
      guard width <= 16384, height <= 16384, width * height <= 64 * 1024 * 1024 else { throw Failure.resourceLimit }
      let normalized = image.transformed(by: CGAffineTransform(translationX: -bounds.minX, y: -bounds.minY))
        .transformed(by: CGAffineTransform(scaleX: width / bounds.width, y: height / bounds.height))
      guard let rendered = context.createCGImage(normalized, from: CGRect(x: 0, y: 0, width: width, height: height),
        format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!) else { throw Failure.sequentialImage }
      return rendered
    }
    if reader.status == .failed { throw readerFailure(reader) }
    throw Failure.sequentialTime
  }

  private func readerFailure(_ reader: AVAssetReader) -> Failure {
    let native = reader.error.map { $0 as NSError }
    let underlying = native?.userInfo[NSUnderlyingErrorKey] as? NSError
    FileHandle.standardError.write(Data("Engine frame reader: status=\(reader.status.rawValue) code=\(native?.code ?? 0) underlying=\(underlying?.code ?? 0)\n".utf8))
    return .sequentialReader
  }
}

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
    guard drawn else { throw Failure.rgbaContext }
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
    guard try await asset.load(.providesPreciseDurationAndTiming) else { throw Failure.preciseTiming }
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw Failure.videoTrack }
    let mappings = try await track.load(.segments).filter { !$0.isEmpty }.map(\.timeMapping)
      .sorted { CMTimeCompare($0.target.start, $1.target.start) < 0 }
    guard !mappings.isEmpty else { throw Failure.segments }
    let sequential = SequentialFrames(asset: asset, track: track, transform: try await track.load(.preferredTransform))
    // Owning package qualification exercises the real fallback for every
    // contract vector; this never changes source selection or output policy.
    let qualifySequential = ProcessInfo.processInfo.environment["APPARENT_ENGINE_QUALIFY_SEQUENTIAL"] == "1"
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
            guard media.seconds.isFinite else { throw Failure.mediaTime }
            guard let cursor = track.makeSampleCursor(presentationTimeStamp: media) else { throw Failure.cursor }
            var steps = 0
            while CMTimeCompare(cursor.presentationTimeStamp, mapping.source.end) >= 0 {
              guard steps < 1024, cursor.stepInPresentationOrder(byCount: -1) != 0 else { throw Failure.cursorRange }
              steps += 1
            }
            let sample = CMTimeMaximum(mapping.target.start,
              CMTimeMapTimeFromRangeToRange(cursor.presentationTimeStamp, fromRange: mapping.source, toRange: mapping.target))
            guard sample.seconds.isFinite else { throw Failure.sampleTime }
            let decoded: (CGImage, CMTime)
            if qualifySequential {
              decoded = (try await sequential.image(at: sample, edge: edge), sample)
            } else {
              do { decoded = try await generator.image(at: sample) }
              catch {
                let native = error as NSError
                guard native.domain == AVFoundationErrorDomain,
                      native.code == AVError.Code.decodeFailed.rawValue else { throw error }
                decoded = (try await sequential.image(at: sample, edge: edge), sample)
              }
            }
            let (image, actual) = decoded
            guard CMTimeCompare(actual, sample) == 0 else {
              // Numeric clock facts only; SDK errors still discard native stderr.
              FileHandle.standardError.write(Data("Engine frame timing: sample=\(sample.value)/\(sample.timescale) actual=\(actual.value)/\(actual.timescale) request=\(times[index])\n".utf8))
              throw Failure.generatorTime
            }
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
      guard !times.isEmpty, times.count <= 480 else { throw Failure.invalidRequest }
      let frames = try await decode(args[1], fd: fd, edge: edge, times: times)
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
      FileHandle.standardOutput.write(try encoder.encode(Reply(version: 1, frames: frames)) + Data([10]))
    } catch {
      if let failure = error as? Failure {
        FileHandle.standardError.write(Data("Engine frames: \(failure.rawValue)\n".utf8))
        if failure == .resourceLimit { exit(72) }
      } else {
        let native = error as NSError
        let underlying = native.userInfo[NSUnderlyingErrorKey] as? NSError
        FileHandle.standardError.write(Data("Engine frames: platform_error code=\(native.code) underlying=\(underlying?.code ?? 0)\n".utf8))
      }
      exit(1)
    }
  }
}
