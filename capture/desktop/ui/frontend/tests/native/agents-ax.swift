// Disposable hosted Settings acceptance only; never shipped in the application.
import Foundation
import AppKit
import ApplicationServices
import Darwin

struct Failure: Error, CustomStringConvertible { let description: String }
let deadline = ProcessInfo.processInfo.systemUptime + 2.8
func require(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !value() { throw Failure(description: message) }
}
func attribute(_ element: AXUIElement, _ key: String, optional: Bool = false) throws -> CFTypeRef? {
    try require(ProcessInfo.processInfo.systemUptime < deadline, "Owned AX deadline exceeded")
    _ = AXUIElementSetMessagingTimeout(element, 0.25)
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, key as CFString, &value)
    if optional && (result == .attributeUnsupported || result == .noValue) { return nil }
    try require(result == .success, "AX attribute \(key) failed: \(result.rawValue)")
    return value
}
func text(_ value: CFTypeRef?) -> String {
    if let value = value as? String { return value }
    if let value = value as? NSNumber { return value.stringValue }
    return ""
}
func children(_ element: AXUIElement, key: String = kAXChildrenAttribute) throws -> [AXUIElement] {
    guard let value = try attribute(element, key, optional: true) else { return [] }
    guard let result = value as? [AXUIElement] else { throw Failure(description: "Unexpected AX children type") }
    try require(result.count <= 100, "Owned AX child bound exceeded")
    return result
}
func main() throws {
    let env = ProcessInfo.processInfo.environment
    try require(env["CI"] == "true" && env["GITHUB_ACTIONS"] == "true" &&
        env["RUNNER_ENVIRONMENT"] == "github-hosted" && env["RUNNER_OS"] == "macOS" &&
        env["APPARENT_STORAGE_NATIVE_CI"] == "1", "Disposable hosted Settings fixture required")
    let args = CommandLine.arguments
    try require(args.count == 5, "Expected owned PID, operation, role and label")
    guard let pid = Int32(args[1]), pid > 1, let appPath = env["APPARENT_STORAGE_NATIVE_APP_DIR"] else {
        throw Failure(description: "Missing owned process identity")
    }
    let op = args[2], requestedRole = args[3], label = args[4]
    try require(["window", "inspect", "press", "value", "space"].contains(op), "Unsupported operation")
    let allowed = ["Agents", "General", "Refresh Agents settings", "Install command-line tool",
                   "Uninstall command-line tool", "Ask agents for a demo video"]
    if op != "window" && op != "inspect" {
        try require(allowed.contains(label) && [kAXButtonRole, kAXCheckBoxRole].contains(requestedRole), "Unsupported Settings control")
        try require((op == "press" && requestedRole == kAXButtonRole) ||
                    (["space", "value"].contains(op) && requestedRole == kAXCheckBoxRole), "Unsupported control action")
    }
    let appURL = URL(fileURLWithPath: appPath).resolvingSymlinksInPath()
    let allowedExecutables = ["Contents/MacOS/apparent-helper",
        "Contents/Resources/settings/runtime/Electron.app/Contents/MacOS/Electron"].map {
        appURL.appendingPathComponent($0).resolvingSymlinksInPath().path
    }
    guard let running = NSRunningApplication(processIdentifier: pid),
          let executable = running.executableURL?.resolvingSymlinksInPath().path else {
        throw Failure(description: "Owned application is absent")
    }
    try require(allowedExecutables.contains(executable), "PID does not map to the installed fixture")
    let app = AXUIElementCreateApplication(pid)
    let windows = try children(app, key: kAXWindowsAttribute)
    try require(windows.count == 1, "Expected exactly one owned Settings window")
    let window = windows[0]
    var windowPID: pid_t = 0
    try require(AXUIElementGetPid(window, &windowPID) == .success && windowPID == pid, "Window PID mismatch")
    if op == "window" {
        print("window=\(text(try attribute(window, kAXTitleAttribute)));pid=\(pid);children=\(try children(window).count)")
        return
    }
    var queue = [window], position = 0, trace = "", matches: [AXUIElement] = []
    while position < queue.count {
        try require(position < 350, "Owned AX tree exceeds bound")
        let element = queue[position]; position += 1
        let role = text(try attribute(element, kAXRoleAttribute))
        var labels: [String] = []
        if role == requestedRole || op == "inspect" {
            for key in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute] {
                let value = text(try attribute(element, key, optional: true))
                try require(value.utf8.count <= 2048, "Owned AX label exceeds bound")
                if !value.isEmpty { labels.append(value) }
            }
        }
        let row = role + labels.map { "|" + $0 }.joined() + "\n"
        trace += row
        try require(trace.utf8.count <= 20000, "Owned AX trace exceeds bound")
        FileHandle.standardError.write(Data(row.utf8))
        if role == requestedRole && labels.contains(label) { matches.append(element) }
        queue += try children(element)
        try require(queue.count <= 350, "Owned AX tree exceeds bound")
    }
    if op == "inspect" { print(trace, terminator: ""); return }
    try require(matches.count == 1, "Missing or ambiguous owned Settings control: \(trace)")
    let target = matches[0]
    if op == "value" { print(text(try attribute(target, kAXValueAttribute))); return }
    try require((try attribute(target, kAXEnabledAttribute)) as? Bool == true, "Owned Settings control disabled")
    try require(running.activate(options: [.activateIgnoringOtherApps]), "Could not activate owned Settings")
    for _ in 0..<10 {
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { break }
        usleep(10000)
    }
    try require(NSWorkspace.shared.frontmostApplication?.processIdentifier == pid, "Owned Settings lost focus")
    if op == "space" {
        try require(AXUIElementSetAttributeValue(target, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success,
                    "Could not focus owned checkbox")
        try require((try attribute(target, kAXFocusedAttribute)) as? Bool == true, "Checkbox did not take focus")
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 49, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 49, keyDown: false) else {
            throw Failure(description: "Could not create Space events")
        }
        try require(ProcessInfo.processInfo.systemUptime < deadline, "No keyboard input after AX deadline")
        // Queue the complete key pair together; no wait or throwing AX call
        // may leave a key held until the outer subprocess timeout.
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    } else {
        try require(AXUIElementPerformAction(target, kAXPressAction as CFString) == .success, "Owned AXPress failed")
    }
    print(trace, terminator: "")
}
do { try main() }
catch { fputs("\(error)\n", stderr); exit(1) }
