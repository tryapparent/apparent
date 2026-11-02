import AppKit
import SwiftUI
import UniformTypeIdentifiers

// Local review installer. Package a separately identified app in SharedSupport.
// Never replaces an existing application, including a previous test candidate.
private let candidateName = "Apparent Onboarding Test.app"
private let candidateID = "dev.apparent.onboarding-test"

enum InstallError: LocalizedError {
  case invalidCandidate, destinationExists
  var errorDescription: String? {
    switch self {
    case .invalidCandidate: "The separate onboarding test app is missing or has an unexpected identity."
    case .destinationExists: "A test app already exists here. Choose another folder to preserve it."
    }
  }
}
func installCandidate(source: URL, folder: URL) throws -> URL {
  guard source.pathExtension == "app", Bundle(url: source)?.bundleIdentifier == candidateID,
    FileManager.default.isExecutableFile(atPath: source.appendingPathComponent("Contents/MacOS/apparent").path)
  else { throw InstallError.invalidCandidate }
  let target = folder.appendingPathComponent(candidateName)
  guard !FileManager.default.fileExists(atPath: target.path) else { throw InstallError.destinationExists }
  // copyItem refuses existing destinations. Never recursively remove on error:
  // another process could have created the destination between this check and copy.
  try FileManager.default.copyItem(at: source, to: target)
  return target
}

@MainActor final class InstallerModel: ObservableObject {
  @Published var busy = false
  @Published var installed: URL?
  @Published var message = ""
  @Published var hopping = false
  let source = Bundle.main.bundleURL.appendingPathComponent("Contents/SharedSupport/" + candidateName)
  func install(folder: URL? = nil) {
    guard !busy, installed == nil else { return }
    let folder = folder ?? FileManager.default.urls(for: .applicationDirectory, in: .userDomainMask)[0]
    busy = true; hopping = true; message = ""
    let source = source
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let target = try installCandidate(source: source, folder: folder)
        DispatchQueue.main.async { self.installed = target; self.busy = false; self.hopping = false; self.message = "Installed separately. Your everyday Apparent is unchanged." }
      } catch {
        DispatchQueue.main.async { self.busy = false; self.hopping = false; self.message = error.localizedDescription }
      }
    }
  }
  func chooseFolder() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = true
    panel.allowsMultipleSelection = false; panel.prompt = "Install here"
    if panel.runModal() == .OK, let folder = panel.url { install(folder: folder) }
  }
  func open() {
    guard let installed else { return }
    let options = NSWorkspace.OpenConfiguration()
    options.createsNewApplicationInstance = true
    NSWorkspace.shared.openApplication(at: installed, configuration: options) { _, error in
      DispatchQueue.main.async {
        if let error { self.message = error.localizedDescription }
        else { NSApp.terminate(nil) }
      }
    }
  }
}

struct InstallerView: View {
  @StateObject private var model = InstallerModel()
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private func image(_ name: String) -> NSImage {
    NSImage(contentsOf: Bundle.main.resourceURL!.appendingPathComponent(name)) ?? NSImage()
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text("Add apparent to Applications.").font(.system(size: 30, weight: .medium))
      Text("Click the frog, or drag the app to Applications.").foregroundStyle(.secondary)
      HStack(spacing: 65) {
        Button { model.install() } label: {
          VStack(spacing: 8) {
            ZStack(alignment: .top) {
              Image(nsImage: image("app-icon.png")).resizable().scaledToFit().frame(width: 85, height: 85)
              Image(nsImage: image("frog-jump.png")).resizable().scaledToFit().frame(width: 100, height: 75).offset(y: -60)
            }
            Text("apparent · local test").font(.system(size: 12))
          }
          .offset(x: model.hopping && !reduceMotion ? 200 : 0, y: model.hopping && !reduceMotion ? -40 : 0)
          .animation(reduceMotion ? nil : .easeInOut(duration: 0.6), value: model.hopping)
        }.buttonStyle(.plain).disabled(model.busy || model.installed != nil)
        .onDrag { NSItemProvider(object: model.source as NSURL) }
        Image(systemName: "arrow.right").font(.system(size: 26)).foregroundStyle(.tertiary)
        VStack(spacing: 10) {
          Image(systemName: "folder.fill").font(.system(size: 78)).foregroundStyle(Color.purple.opacity(0.35))
          Text("Applications").font(.system(size: 13))
        }.onDrop(of: [.fileURL], isTargeted: nil) { providers in
          guard !model.busy, model.installed == nil, providers.count == 1 else { return false }
          providers[0].loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
            let url = (item as? URL) ?? (item as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) }
            DispatchQueue.main.async {
              if url?.standardizedFileURL == model.source.standardizedFileURL { model.install() }
            }
          }
          return true
        }
      }.frame(maxWidth: .infinity).padding(.top, 75).padding(.bottom, 40)
      Text(model.message.isEmpty ? "No existing application will be replaced." : model.message)
        .font(.system(size: 12)).foregroundStyle(.secondary).frame(minHeight: 30)
      HStack {
        Button("Choose another folder…") { model.chooseFolder() }.disabled(model.busy || model.installed != nil)
        Spacer()
        Button("Open apparent test") { model.open() }.buttonStyle(.borderedProminent).disabled(model.installed == nil)
      }
    }.padding(36).frame(width: 650).background(Color(red: 0.98, green: 0.975, blue: 0.965))
      .tint(Color(red: 0.48, green: 0.35, blue: 0.70))
  }
}
#if !INSTALLER_TEST
@main struct LocalInstaller: App {
  var body: some Scene {
    WindowGroup("Install apparent · local test") { InstallerView() }.windowResizability(.contentSize)
  }
}

#else
@main struct InstallerChecks {
  static func main() throws {
    let fm = FileManager.default
    let root = fm.temporaryDirectory.appendingPathComponent("apparent-installer-" + UUID().uuidString)
    try fm.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: root) }
    let source = root.appendingPathComponent("Candidate.app")
    let macos = source.appendingPathComponent("Contents/MacOS")
    try fm.createDirectory(at: macos, withIntermediateDirectories: true)
    let plist = try PropertyListSerialization.data(fromPropertyList: ["CFBundleIdentifier": candidateID, "CFBundleExecutable": "apparent"], format: .xml, options: 0)
    try plist.write(to: source.appendingPathComponent("Contents/Info.plist"))
    let executable = macos.appendingPathComponent("apparent")
    try Data("#!/bin/sh\nexit 0\n".utf8).write(to: executable)
    try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
    let destination = root.appendingPathComponent("Applications")
    try fm.createDirectory(at: destination, withIntermediateDirectories: true)
    let installed = try installCandidate(source: source, folder: destination)
    precondition(fm.fileExists(atPath: installed.appendingPathComponent("Contents/MacOS/apparent").path))
    do { _ = try installCandidate(source: source, folder: destination); fatalError("overwrite accepted") }
    catch InstallError.destinationExists { }
    precondition(fm.fileExists(atPath: executable.path))
    do { _ = try installCandidate(source: root.appendingPathComponent("Wrong.app"), folder: root); fatalError("invalid source accepted") }
    catch InstallError.invalidCandidate { }
    print("Installer copy, overwrite refusal, source preservation and identity checks passed")
  }
}
#endif
