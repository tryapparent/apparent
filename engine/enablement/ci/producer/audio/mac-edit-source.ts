export const editSource = `
import AVFoundation
import CoreMedia
import Foundation
@main struct EditFixtures {
  static func emptyEdit(_ input:String,_ at:CMTime,_ destination:String)async throws {
    let asset=AVURLAsset(url:URL(fileURLWithPath:input))
    guard let source=try await asset.loadTracks(withMediaType:.audio).first else { throw NSError(domain:"synthetic-edit-source",code:1) }
    let composition=AVMutableComposition()
    guard let target=composition.addMutableTrack(withMediaType:.audio,preferredTrackID:kCMPersistentTrackID_Invalid) else {
      throw NSError(domain:"synthetic-edit-track",code:1)
    }
    try target.insertTimeRange(try await source.load(.timeRange),of:source,at:.zero)
    target.insertEmptyTimeRange(CMTimeRange(start:at,duration:CMTime(value:3072,timescale:16000)))
    guard let exporter=AVAssetExportSession(asset:composition,presetName:AVAssetExportPresetPassthrough) else {
      throw NSError(domain:"synthetic-edit-export",code:1)
    }
    try await exporter.export(to:URL(fileURLWithPath:destination),as:.mov)
  }
  static func main()async throws {
    guard CommandLine.arguments.count==5 else { throw NSError(domain:"synthetic-edit-arguments",code:1) }
    try await emptyEdit(CommandLine.arguments[1],CMTime(value:12288,timescale:16000),CommandLine.arguments[3])
    try await emptyEdit(CommandLine.arguments[2],CMTime(value:20256,timescale:16000),CommandLine.arguments[4])
  }
}
`;
