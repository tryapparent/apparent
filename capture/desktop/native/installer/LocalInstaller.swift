import AppKit
import SwiftUI
import UniformTypeIdentifiers

// Each candidate gets a fresh location automatically; existing apps remain intact.
private let candidateName = "Apparent Onboarding Test.app"
private let candidateID = "dev.apparent.onboarding-test"

enum InstallError: LocalizedError {
  case invalidCandidate, invalidDestination
  var errorDescription: String? {
    switch self {
    case .invalidCandidate: "The onboarding preview is missing or has an unexpected identity."
    case .invalidDestination: "Choose a folder outside the installer’s source app."
    }
  }
}
func installCandidate(source: URL, folder: URL) throws -> URL {
  let fm = FileManager.default
  let sourcePath = source.resolvingSymlinksInPath().standardizedFileURL.path
  let folderPath = folder.resolvingSymlinksInPath().standardizedFileURL.path
  guard folderPath != sourcePath, !folderPath.hasPrefix(sourcePath + "/") else { throw InstallError.invalidDestination }
  guard source.pathExtension == "app",
    let data = try? Data(contentsOf: source.appendingPathComponent("Contents/Info.plist")),
    let info = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
    info["CFBundleIdentifier"] as? String == candidateID,
    let build = info["ApparentTestBuildID"] as? String,
    build.count == 40, build.allSatisfy({ "0123456789abcdef".contains($0) }),
    fm.isExecutableFile(atPath: source.appendingPathComponent("Contents/MacOS/apparent").path)
  else { throw InstallError.invalidCandidate }
  var target = folder.appendingPathComponent(candidateName)
  if fm.fileExists(atPath: target.path) {
    let fallback = folder.appendingPathComponent("Apparent Onboarding Test Builds")
    let resolvedFallback = fallback.resolvingSymlinksInPath().standardizedFileURL.path
    guard resolvedFallback != sourcePath, !resolvedFallback.hasPrefix(sourcePath + "/") else { throw InstallError.invalidDestination }
    target = fallback.appendingPathComponent(build + "-" + UUID().uuidString)
      .appendingPathComponent(candidateName)
  }
  // The fallback may contain an existing symlink. Recheck the derived location
  // before mkdir or copy, including any resolved parent of a not-yet-existing leaf.
  for url in [target, target.deletingLastPathComponent()] {
    let resolved = url.resolvingSymlinksInPath().standardizedFileURL.path
    guard resolved != sourcePath, !resolved.hasPrefix(sourcePath + "/") else { throw InstallError.invalidDestination }
  }
  try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
  // copyItem refuses an occupied destination, including a concurrent creation.
  // Never delete or replace another app, or execute an old copy based on its name.
  try fm.copyItem(at: source, to: target)
  return target
}

struct FrogHop: GeometryEffect {
  var progress: CGFloat
  var animatableData: CGFloat { get { progress } set { progress = newValue } }
  static func offset(at progress: CGFloat) -> CGPoint {
    let t = min(1, max(0, progress))
    if t == 0 { return .zero }
    if t == 1 { return CGPoint(x: 262, y: 28) }
    let first = min(1, t / 0.75)
    let y = t <= 0.75 ? 28 * first - 96 * sin(.pi * first) : 28 - 20 * sin(.pi * (t - 0.75) / 0.25)
    return CGPoint(x: 262 * first, y: y)
  }
  func effectValue(size: CGSize) -> ProjectionTransform {
    let offset = Self.offset(at: progress)
    return ProjectionTransform(CGAffineTransform(translationX: offset.x, y: offset.y))
  }
}

func hasOlderTest(installed: URL, running: [(id: String?, path: URL?)]) -> Bool {
  let current = installed.resolvingSymlinksInPath().standardizedFileURL.path
  return running.contains { app in
    guard app.id == candidateID || app.id == candidateID + ".ui" else { return false }
    guard let path = app.path?.resolvingSymlinksInPath().standardizedFileURL.path else { return true }
    return path != current && !path.hasPrefix(current + "/")
  }
}

@MainActor final class InstallerModel: ObservableObject {
  @Published var busy = false
  @Published var installed: URL?
  @Published var message = ""
  @Published var hopSerial = 0
  let source = Bundle.main.bundleURL.appendingPathComponent("Contents/SharedSupport/" + candidateName)
  func install(folder: URL? = nil, animationDuration: TimeInterval = 1.05) {
    guard !busy, installed == nil else { return }
    let folder = folder ?? FileManager.default.urls(for: .applicationDirectory, in: .userDomainMask)[0]
    busy = true; hopSerial += 1; message = ""
    let began = Date()
    let source = source
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let target = try installCandidate(source: source, folder: folder)
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, animationDuration - Date().timeIntervalSince(began))) { self.installed = target; self.busy = false; self.message = "Preview 5 is installed and ready to open." }
      } catch {
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, animationDuration - Date().timeIntervalSince(began))) { self.busy = false; self.message = error.localizedDescription }
      }
    }
  }
  func chooseFolder(animationDuration: TimeInterval = 1.05) {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = true
    panel.allowsMultipleSelection = false; panel.prompt = "Install here"
    if panel.runModal() == .OK, let folder = panel.url { install(folder: folder, animationDuration: animationDuration) }
  }
  func open() {
    guard let installed else { return }
    let previous = hasOlderTest(installed: installed, running: NSWorkspace.shared.runningApplications.map { (id: $0.bundleIdentifier, path: $0.bundleURL) })
    guard !previous else {
      message = "Quit the previous onboarding test from its menu, then click Open again."
      return
    }
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
  @State private var hopProgress: CGFloat = 0
  private func install() { model.install(animationDuration: reduceMotion ? 0 : 1.05) }
  private func image(_ name: String) -> NSImage {
    NSImage(contentsOf: Bundle.main.resourceURL!.appendingPathComponent(name)) ?? NSImage()
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text("Add apparent to Applications.").font(.system(size: 30, weight: .medium))
      Text("Click the frog, or drag the app to Applications.").foregroundStyle(.secondary)
      HStack(spacing: 40) {
        Button { install() } label: {
          VStack(spacing: 8) {
            ZStack(alignment: .top) {
              Image(nsImage: image("app-icon.png")).resizable().scaledToFit().frame(width: 85, height: 85)
              Image(nsImage: image("frog-jump.png")).resizable().scaledToFit().frame(width: 100, height: 75).offset(y: -60)
                .modifier(FrogHop(progress: hopProgress))
            }
            Text("apparent · local test").font(.system(size: 12))
          }
          .frame(width: 150)
        }.buttonStyle(.plain).disabled(model.busy || model.installed != nil)
        .onDrag { NSItemProvider(object: model.source as NSURL) }
        Image(systemName: "arrow.right").font(.system(size: 26)).foregroundStyle(.tertiary).frame(width: 32)
        VStack(spacing: 10) {
          Image(systemName: "folder.fill").font(.system(size: 78)).foregroundStyle(Color.purple.opacity(0.35))
          Text("Applications").font(.system(size: 13))
        }.frame(width: 150).onDrop(of: [.fileURL], isTargeted: nil) { providers in
          guard !model.busy, model.installed == nil, providers.count == 1 else { return false }
          providers[0].loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
            let url = (item as? URL) ?? (item as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) }
            DispatchQueue.main.async {
              if url?.standardizedFileURL == model.source.standardizedFileURL { install() }
            }
          }
          return true
        }
      }.frame(maxWidth: .infinity).padding(.top, 75).padding(.bottom, 40)
      Text(model.message.isEmpty ? "Previous previews are kept. A location is chosen automatically." : model.message)
        .font(.system(size: 12)).foregroundStyle(.secondary).frame(minHeight: 30)
      HStack {
        Button("Choose location…") { model.chooseFolder(animationDuration: reduceMotion ? 0 : 1.05) }.disabled(model.busy || model.installed != nil)
        Spacer()
        Button("Open preview 5") { model.open() }.buttonStyle(.borderedProminent).disabled(model.installed == nil)
      }
    }.padding(36).frame(width: 650).background(Color(red: 0.98, green: 0.975, blue: 0.965))
      .tint(Color(red: 0.48, green: 0.35, blue: 0.70))
      .onChange(of: model.hopSerial) { _, _ in
        var instant = Transaction(); instant.disablesAnimations = true
        withTransaction(instant) { hopProgress = 0 }
        DispatchQueue.main.async {
          withAnimation(reduceMotion ? nil : .linear(duration: 1.05)) { hopProgress = 1 }
        }
      }
  }
}
#if !INSTALLER_TEST
@main struct LocalInstaller: App {
  var body: some Scene {
    WindowGroup("Install Apparent · preview 5") { InstallerView() }.windowResizability(.contentSize)
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
    let plist = try PropertyListSerialization.data(fromPropertyList: ["CFBundleIdentifier": candidateID, "CFBundleExecutable": "apparent", "ApparentTestBuildID": String(repeating: "a", count: 40)], format: .xml, options: 0)
    try plist.write(to: source.appendingPathComponent("Contents/Info.plist"))
    let executable = macos.appendingPathComponent("apparent")
    try Data("#!/bin/sh\nexit 0\n".utf8).write(to: executable)
    try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
    let destination = root.appendingPathComponent("Applications")
    try fm.createDirectory(at: destination, withIntermediateDirectories: true)
    let installed = try installCandidate(source: source, folder: destination)
    precondition(fm.fileExists(atPath: installed.appendingPathComponent("Contents/MacOS/apparent").path))
    let original = try Data(contentsOf: installed.appendingPathComponent("Contents/MacOS/apparent"))
    let updatedBytes = Data("#!/bin/sh\n# newer candidate\nexit 0\n".utf8)
    try updatedBytes.write(to: executable)
    try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
    let second = try installCandidate(source: source, folder: destination)
    precondition(second != installed)
    let preserved = try Data(contentsOf: installed.appendingPathComponent("Contents/MacOS/apparent"))
    precondition(preserved == original)
    let secondBytes = try Data(contentsOf: second.appendingPathComponent("Contents/MacOS/apparent"))
    precondition(secondBytes == updatedBytes)
    do { _ = try installCandidate(source: source, folder: source); fatalError("nested source accepted") }
    catch InstallError.invalidDestination { }
    let linkedDestination = root.appendingPathComponent("LinkedApplications")
    try fm.createDirectory(at: linkedDestination, withIntermediateDirectories: true)
    try Data("keep".utf8).write(to: linkedDestination.appendingPathComponent(candidateName))
    try fm.createSymbolicLink(at: linkedDestination.appendingPathComponent("Apparent Onboarding Test Builds"), withDestinationURL: source)
    let beforeLink = try fm.subpathsOfDirectory(atPath: source.path).sorted()
    do { _ = try installCandidate(source: source, folder: linkedDestination); fatalError("source-contained fallback accepted") }
    catch InstallError.invalidDestination { }
    let afterLink = try fm.subpathsOfDirectory(atPath: source.path).sorted()
    precondition(beforeLink == afterLink)
    precondition(hasOlderTest(installed: second, running: [(candidateID, installed)]))
    precondition(!hasOlderTest(installed: second, running: [(candidateID, second)]))
    precondition(!hasOlderTest(installed: second, running: [("dev.kitlangton.apparent", installed)]))
    precondition(hasOlderTest(installed: second, running: [(candidateID + ".ui", installed.appendingPathComponent("Contents/Resources/UI.app"))]))
    precondition(!hasOlderTest(installed: second, running: [(candidateID + ".ui", second.appendingPathComponent("Contents/Resources/UI.app"))]))
    precondition(FrogHop.offset(at: 0) == .zero)
    precondition(FrogHop.offset(at: 0.375).y < -70)
    precondition(FrogHop.offset(at: 0.75).x == FrogHop.offset(at: 1).x)
    precondition(FrogHop.offset(at: 0.875).y < FrogHop.offset(at: 1).y)
    precondition(FrogHop.offset(at: 1) == CGPoint(x: 262, y: 28))
    precondition(fm.fileExists(atPath: executable.path))
    do { _ = try installCandidate(source: root.appendingPathComponent("Wrong.app"), folder: root); fatalError("invalid source accepted") }
    catch InstallError.invalidCandidate { }
    let wrong = root.appendingPathComponent("Ordinary.app")
    try fm.copyItem(at: source, to: wrong)
    let wrongInfo = try PropertyListSerialization.data(fromPropertyList: ["CFBundleIdentifier": "dev.kitlangton.apparent", "ApparentTestBuildID": String(repeating: "b", count: 40)], format: .xml, options: 0)
    try wrongInfo.write(to: wrong.appendingPathComponent("Contents/Info.plist"))
    let forbidden = root.appendingPathComponent("MustNotBeCreated")
    do { _ = try installCandidate(source: wrong, folder: forbidden); fatalError("ordinary app accepted") }
    catch InstallError.invalidCandidate { }
    precondition(!fm.fileExists(atPath: forbidden.path))
    print("Installer automatic destination, source/old-app preservation, identity and frog trajectory checks passed")
  }
}
#endif
