// Private descriptor bridge for the existing media worker; never a public RPC endpoint.
import AVFoundation
import Foundation
import Darwin

struct HelperError: Error { let message: String; init(_ message: String) { self.message = message } }
// The shared donor also contains transcription operations; this entry never invokes them.
func emit(_ value: [String: Any]) {}

private struct Request: Decodable {
  let times: [UInt64]
  let maxEdge: Int
  let maxPixels: UInt64
}

@main struct FramesBridge {
  static func main() async {
    if CommandLine.arguments.dropFirst() == ["--version"] {
      print("apparent-engine-frames-native/1")
      return
    }
    guard CommandLine.arguments.dropFirst() == ["--decode-pinned-frames"] else { exit(1) }
    // The Rust owner holds the other end. This is the existing worker's portable
    // parent-death mechanism, extended through this private native subprocess.
    DispatchQueue.global().async {
      var byte: UInt8 = 0
      _ = Darwin.read(4, &byte, 1)
      Darwin._exit(1)
    }
    do {
      var data = Data()
      while let chunk = try FileHandle.standardInput.read(upToCount: 8193 - data.count), !chunk.isEmpty {
        data.append(chunk)
        guard data.count <= 8192 else { throw HelperError("limits_exceeded") }
      }
      let request = try JSONDecoder().decode(Request.self, from: data)
      guard (1...48).contains(request.times.count), (1...4096).contains(request.maxEdge),
            (1...64_000_000).contains(request.maxPixels),
            request.times.allSatisfy({ $0 <= UInt64(Int64.max) }) else { throw HelperError("limits_exceeded") }
      var metadata = stat()
      guard fstat(3, &metadata) == 0, metadata.st_mode & S_IFMT == S_IFREG,
            metadata.st_size > 0 else { throw HelperError("source_incomplete") }
      let asset = AVURLAsset(url: URL(fileURLWithPath: "/dev/fd/3"), options: [
        // The descriptor has no extension. Give the ISO-BMFF parser its format
        // explicitly; never fall back to reopening the original caller path.
        AVURLAssetOverrideMIMETypeKey: "video/mp4",
        AVURLAssetReferenceRestrictionsKey: NSNumber(value: AVAssetReferenceRestrictions.forbidAll.rawValue),
        AVURLAssetPreferPreciseDurationAndTimingKey: true,
      ])
      let seconds = try await asset.load(.duration).seconds
      guard seconds.isFinite, seconds > 0, seconds * 1000 < Double(Int64.max),
            let track = try await asset.loadTracks(withMediaType: .video).first else { throw HelperError("source_incomplete") }
      let natural = try await track.load(.naturalSize)
      guard natural.width > 0, natural.height > 0, natural.width <= 16_384, natural.height <= 16_384,
            natural.width * natural.height * 4 <= 256 * 1024 * 1024 else { throw HelperError("limits_exceeded") }
      let duration = UInt64((seconds * 1000).rounded(.up))
      var total: UInt64 = 0
      for requested in request.times {
        let clamped = requested >= duration
        let target = min(requested, duration - 1)
        // Preserve the donor's explicit-time tolerance. At the end, permit the
        // decoder to return the last available frame rather than silently skip it.
        let tolerance = CMTime(value: 80, timescale: 1000)
        let generator = Media.frameGenerator(asset: asset, maxEdge: request.maxEdge,
          before: clamped ? .positiveInfinity : tolerance, after: clamped ? .zero : tolerance)
        let result = try await generator.image(at: CMTime(value: Int64(target), timescale: 1000))
        let image = result.image
        guard image.width > 0, image.height > 0, max(image.width, image.height) <= request.maxEdge else { throw HelperError("limits_exceeded") }
        let pixels = UInt64(image.width) * UInt64(image.height)
        guard pixels <= request.maxPixels - total else { throw HelperError("limits_exceeded") }
        total += pixels
        let rgba = try Media.rgbaPixels(image)
        guard rgba.count == pixels * 4, result.actualTime.seconds.isFinite,
              result.actualTime.seconds >= 0, result.actualTime.seconds * 1000 <= 9_007_199_254_740_991 else { throw HelperError("source_incomplete") }
        let actual = UInt64((result.actualTime.seconds * 1000).rounded())
        // Fixed-width little-endian header followed by exactly byteLength RGBA
        // bytes. Media bytes never enter JSON or a pathname scratch file.
        var header = Data()
        for value in [UInt64(image.width), UInt64(image.height), actual, duration, clamped ? 1 : 0, UInt64(rgba.count)] {
          var little = value.littleEndian
          withUnsafeBytes(of: &little) { header.append(contentsOf: $0) }
        }
        try FileHandle.standardOutput.write(contentsOf: header)
        try FileHandle.standardOutput.write(contentsOf: rgba)
      }
    } catch {
      var code: UInt64 = 3
      if let error = error as? HelperError {
        if error.message == "limits_exceeded" { code = 1 }
        if error.message == "source_incomplete" { code = 2 }
      }
      var header = Data()
      for value in [0, 0, code, 0, 0, 0] as [UInt64] {
        var little = value.littleEndian
        withUnsafeBytes(of: &little) { header.append(contentsOf: $0) }
      }
      try? FileHandle.standardOutput.write(contentsOf: header)
      let native = error as NSError
      let domains = ["AVFoundationErrorDomain", "NSOSStatusErrorDomain", "NSCocoaErrorDomain", "NSPOSIXErrorDomain"]
      let domain = domains.contains(native.domain) ? native.domain : "NativeError"
      FileHandle.standardError.write(Data("Native frame decode failed (\(domain):\(native.code))\n".utf8))
      exit(1)
    }
  }
}
