// Disposable hosted-CI display only; no recording, input, network or permissions.
import Foundation
import AppKit
let environment = ProcessInfo.processInfo.environment
guard environment["CI"] == "true", environment["GITHUB_ACTIONS"] == "true",
      environment["RUNNER_ENVIRONMENT"] == "github-hosted", environment["RUNNER_OS"] == "macOS" else { exit(64) }
let application = NSApplication.shared
application.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 80, y: 100, width: 960, height: 620),
    styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "Apparent foreground test — SYNTHETIC"
window.isReleasedWhenClosed = false
let content = NSView(frame: NSRect(x: 0, y: 0, width: 960, height: 620))
content.wantsLayer = true
content.layer?.backgroundColor = NSColor(calibratedRed: 0.12, green: 0.17, blue: 0.32, alpha: 1).cgColor
let banner = NSTextField(labelWithString: "SYNTHETIC foreground upload verification")
banner.frame = NSRect(x: 35, y: 535, width: 890, height: 44)
banner.font = .systemFont(ofSize: 27, weight: .semibold)
banner.textColor = .white
content.addSubview(banner)
let counter = NSTextField(labelWithString: "Generated display · no personal content")
counter.frame = NSRect(x: 35, y: 465, width: 890, height: 36)
counter.font = .monospacedSystemFont(ofSize: 20, weight: .regular)
counter.textColor = .white
content.addSubview(counter)
window.contentView = content
application.finishLaunching()
window.makeKeyAndOrderFront(nil)
application.activate(ignoringOtherApps: true)
DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
    print("{\"ready\":true,\"pid\":\(ProcessInfo.processInfo.processIdentifier)}")
    fflush(stdout)
}
application.run()
