import Foundation
import AppKit
import Vision
import CoreGraphics
import ApplicationServices
import Darwin

struct Refusal: Error { let message: String }
func need(_ yes: @autoclosure () throws -> Bool, _ message: String) throws { if try !yes() { throw Refusal(message: message) } }
let fm = FileManager.default
let env = ProcessInfo.processInfo.environment
let args = CommandLine.arguments
func lstatIsLink(_ path: String) -> Bool {
    var s = stat(); return path.withCString { lstat($0, &s) == 0 && (s.st_mode & S_IFMT) == S_IFLNK }
}
var jobDir: URL?
let helperDeadline = ProcessInfo.processInfo.systemUptime + 8
func withinBudget() throws { try need(ProcessInfo.processInfo.systemUptime < helperDeadline, "Adapter exceeded eight-second budget") }
func safeOwnedPath(_ url: URL, root: URL) throws {
    let p = url.standardizedFileURL.path, r = root.standardizedFileURL.path
    try need(p.hasPrefix(r + "/"), "Request/output path outside private job directory")
    var cur = r
    for part in url.standardizedFileURL.pathComponents.dropFirst(root.pathComponents.count) {
        cur += "/" + part
        try need(!lstatIsLink(cur), "Symlink in request/output path")
    }
}
func run(_ path: String, _ arguments: [String], _ limit: TimeInterval = 1) throws -> String {
    let p = Process(); p.executableURL = URL(fileURLWithPath: path); p.arguments = arguments
    p.environment = [:]
    let log = (jobDir ?? URL(fileURLWithPath: env["RUNNER_TEMP"] ?? "/invalid")).appendingPathComponent("subprocess-\(UUID().uuidString).log")
    guard fm.createFile(atPath: log.path, contents: nil, attributes: [.posixPermissions: 0o600]), let handle = try? FileHandle(forWritingTo: log) else { throw Refusal(message: "Could not create private subprocess log") }
    p.standardOutput = handle; p.standardError = handle
    try p.run(); let end = Date().addingTimeInterval(min(limit, max(0, helperDeadline - ProcessInfo.processInfo.systemUptime)))
    while p.isRunning && Date() < end { Thread.sleep(forTimeInterval: 0.02) }
    if p.isRunning {
        p.terminate()
        let grace = Date().addingTimeInterval(0.1)
        while p.isRunning && Date() < grace { Thread.sleep(forTimeInterval: 0.01) }
        if p.isRunning { kill(p.processIdentifier, SIGKILL) }
        let killed = Date().addingTimeInterval(0.5)
        while p.isRunning && Date() < killed { Thread.sleep(forTimeInterval: 0.01) }
        try need(!p.isRunning, "Owned subprocess did not stop after kill")
    }
    try handle.close()
    if Date() >= end { throw Refusal(message: "Bounded subprocess timeout") }
    try need(p.terminationStatus == 0, "Bounded subprocess failed")
    let bytes = try Data(contentsOf: log)
    try need(bytes.count <= 131072, "Owned subprocess exceeded output bound")
    return String(data: bytes, encoding: .utf8) ?? ""
}
func frontPID() -> pid_t {
    RunLoop.main.run(until: Date().addingTimeInterval(0.01))
    return NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1
}
struct Pill { let pid: pid_t; let id: CGWindowID; let rect: CGRect }
func ancestry(_ root: pid_t) throws -> Set<pid_t> {
    let rows = try run("/bin/ps", ["-axo", "pid=,ppid="], 1).split(separator: "\n").prefix(4096)
    var parents: [pid_t: pid_t] = [:]
    for row in rows { let n = row.split(whereSeparator: { $0 == " " || $0 == "\t" }); if n.count == 2, let a = Int32(n[0]), let b = Int32(n[1]) { parents[a] = b } }
    var found: Set<pid_t> = [root], changed = true
    while changed && found.count < 128 { changed = false; for (pid, parent) in parents where found.contains(parent) && !found.contains(pid) { found.insert(pid); changed = true } }
    return found
}
func exactExe(_ pid: pid_t, _ path: String) -> Bool {
    guard let app = NSRunningApplication(processIdentifier: pid), let exe = app.executableURL else { return false }
    return exe.standardizedFileURL.path == path
}
func pill(_ req: [String: Any]) throws -> (Pill, Set<pid_t>) {
    let app = req["app"] as! String, root = pid_t(req["rootPid"] as! Int)
    let expectedRoot = (env["HOME"] ?? "") + "/Applications/"
    let exact = expectedRoot + "Apparent-Storage-\(env["GITHUB_RUN_ID"] ?? "")-\(env["GITHUB_RUN_ATTEMPT"] ?? "").app"
    try need(app == exact, "App bundle is not the exact run-attempt app path")
    let appURL = URL(fileURLWithPath: app).standardizedFileURL
    try need(!lstatIsLink(appURL.path) && exactExe(root, app + "/Contents/MacOS/apparent"), "Root PID does not map to requested app")
    let descendants = try ancestry(root)
    let electron = app + "/Contents/Resources/settings/runtime/Electron.app/Contents/MacOS/Electron"
    let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let matches: [Pill] = rows.compactMap { row in
        guard let owner = row[kCGWindowOwnerPID as String] as? Int32, descendants.contains(owner),
              row[kCGWindowName as String] as? String == "Apparent recording controls",
              (row[kCGWindowAlpha as String] as? Double ?? 0) > 0,
              let id = row[kCGWindowNumber as String] as? UInt32,
              let d = row[kCGWindowBounds as String] as? [String: Any], let rect = CGRect(dictionaryRepresentation: d as CFDictionary),
              exactExe(owner, electron) else { return nil }
        return Pill(pid: owner, id: id, rect: rect)
    }
    if matches.count != 1 {
        let candidates = rows.filter { descendants.contains($0[kCGWindowOwnerPID as String] as? Int32 ?? -1) }.prefix(12).map { row in
            ["pid": row[kCGWindowOwnerPID as String] ?? -1,
             "id": row[kCGWindowNumber as String] ?? -1,
             "title": String((row[kCGWindowName as String] as? String ?? "<unavailable>").prefix(128))] as [String: Any]
        }
        let details = String(data: try JSONSerialization.data(withJSONObject: candidates), encoding: .utf8) ?? "[]"
        throw Refusal(message: "Expected exactly one visible mapped pill; owned candidates=" + details)
    }
    return (matches[0], descendants)
}
struct Word { let text: String; let box: CGRect; let candidate: VNRecognizedText }
func observe(_ req: [String: Any], _ png: URL) throws -> ([String: Any], [Word], Set<pid_t>) {
    let (w, _) = try pill(req)
    _ = try run("/usr/sbin/screencapture", ["-x", "-o", "-l", String(w.id), png.path], 3)
    var imageStat = stat(); try need(png.path.withCString({ lstat($0, &imageStat) }) == 0 && (imageStat.st_mode & S_IFMT) == S_IFREG, "Window screenshot output is not a regular file")
    let vr = VNRecognizeTextRequest(); vr.recognitionLevel = .accurate; vr.usesLanguageCorrection = false
    try VNImageRequestHandler(url: png).perform([vr]); try withinBudget()
    let words = (vr.results ?? []).compactMap { o -> Word? in guard let c = o.topCandidates(1).first else { return nil }; return Word(text: c.string, box: o.boundingBox, candidate: c) }
    let front = frontPID()
    let pillDescendants = try ancestry(w.pid)
    return (["pid": Int(w.pid), "windowId": Int(w.id), "bounds": [w.rect.minX,w.rect.minY,w.rect.width,w.rect.height], "words": words.map { ["text":$0.text,"box":[$0.box.minX,$0.box.minY,$0.box.width,$0.box.height]] as [String:Any] }, "frontPid": Int(front)], words, pillDescendants)
}
func main() throws {
    try need(env["CI"] == "true" && env["GITHUB_ACTIONS"] == "true" && env["RUNNER_ENVIRONMENT"] == "github-hosted" && env["RUNNER_OS"] == "macOS", "Refusing outside GitHub-hosted macOS CI")
    try need(args.count == 2, "Expected one JSON request path")
    let runner = URL(fileURLWithPath: env["RUNNER_TEMP"] ?? "/invalid").standardizedFileURL
    let reqURL = URL(fileURLWithPath: args[1]).standardizedFileURL
    try safeOwnedPath(reqURL, root: runner)
    var st = stat(); try need(reqURL.path.withCString({ lstat($0, &st) }) == 0 && (st.st_mode & S_IFMT) == S_IFREG && st.st_mode & 0o077 == 0 && st.st_size <= 8192, "Request must be a bounded private regular file")
    guard let req = try JSONSerialization.jsonObject(with: Data(contentsOf: reqURL)) as? [String: Any] else { throw Refusal(message: "Request is not an object") }
    try need(req["app"] is String && req["output"] is String && req["rootPid"] is Int && req["operation"] is String, "Invalid request fields")
    let rootPid = req["rootPid"] as! Int
    try need(rootPid > 1 && rootPid <= Int(Int32.max), "Invalid root PID")
    let op = req["operation"] as! String, out = URL(fileURLWithPath: req["output"] as! String).standardizedFileURL
    try need(op == "snapshot" || op == "click", "Unknown operation")
    if op == "click" { try need(["Copy link", "Cancel upload", "Retry upload"].contains(req["label"] as? String ?? ""), "Unsupported click label") }
    try safeOwnedPath(out, root: runner)
    try need(!fm.fileExists(atPath: out.path), "Output must be fresh")
    let job = reqURL.deletingLastPathComponent(); jobDir = job
    var js = stat(); try need(job.path.hasPrefix(runner.path + "/") && !lstatIsLink(job.path) && job.pathComponents.count == runner.pathComponents.count + 1 && job.path.withCString({ lstat($0, &js) }) == 0 && js.st_uid == getuid() && js.st_mode & 0o777 == 0o700, "Job directory must be private, owned and directly under RUNNER_TEMP")
    try safeOwnedPath(out, root: job)
    try need(st.st_uid == getuid(), "Request file must be owned by current user")
    let (before, words, pillDescendants) = try observe(req, out)
    if op == "snapshot" { print(String(data: try JSONSerialization.data(withJSONObject: before), encoding: .utf8)!); return }
    try need(op == "click", "Unknown operation")
    let label = req["label"] as! String; try need(["Copy link", "Cancel upload", "Retry upload"].contains(label), "Unsupported click label")
    let matching = try words.compactMap { word -> CGRect? in guard let range = word.text.range(of: label) else { return nil }; return try word.candidate.boundingBox(for: range)?.boundingBox }
    try need(matching.count == 1, "Label OCR match is missing or ambiguous")
    let b = before["bounds"] as! [CGFloat], box = matching[0]
    try need(box.minX >= 0 && box.minY >= 0 && box.maxX <= 1 && box.maxY <= 1 && box.width > 0 && box.height > 0, "OCR target outside owned image")
    let point = CGPoint(x: b[0] + box.midX*b[2], y: b[1] + (1-box.midY)*b[3])
    try need(frontPID() == pid_t(before["frontPid"] as! Int), "Foreground drift before pointer movement")
    let ax = AXUIElementCreateSystemWide(); _ = AXUIElementSetMessagingTimeout(ax, 0.2)
    let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)
    try need(move != nil, "Could not create native mouse movement")
    move!.post(tap: .cghidEventTap)
    let started = ProcessInfo.processInfo.systemUptime
    var hit: pid_t = -1
    while ProcessInfo.processInfo.systemUptime - started < 1.5 {
        var target: AXUIElement?; let err = AXUIElementCopyElementAtPosition(ax, Float(point.x), Float(point.y), &target)
        if err == .success, let target {
            var p: pid_t = -1; _ = AXUIElementGetPid(target, &p); hit = p
            if pillDescendants.contains(hit) { break }
        } else if err != .cannotComplete && err != .noValue { throw Refusal(message: "AX input hit observation failed") }
        Thread.sleep(forTimeInterval: 0.025)
    }
    try need(pillDescendants.contains(hit), "AX input hit is not owned by the pill renderer")
    let frontBefore = frontPID()
    try need(frontBefore == pid_t(before["frontPid"] as! Int), "Foreground drift before input")
    let fresh = out.deletingLastPathComponent().appendingPathComponent("reobserve-\(getpid()).png")
    try safeOwnedPath(fresh, root: runner); try need(!fm.fileExists(atPath: fresh.path), "Re-observation output is not fresh")
    let (again, _, _) = try observe(req, fresh)
    try withinBudget()
    try need((again["windowId"] as! Int) == (before["windowId"] as! Int) && (again["bounds"] as! [CGFloat]) == b, "Pill window changed before input")
    try need((frontPID()) == frontBefore, "Foreground drift before click")
    var finalTarget: AXUIElement?
    try need(AXUIElementCopyElementAtPosition(ax, Float(point.x), Float(point.y), &finalTarget) == .success, "Final input receiver unavailable")
    var finalPID: pid_t = -1
    if let finalTarget { _ = AXUIElementGetPid(finalTarget, &finalPID) }
    try need(pillDescendants.contains(finalPID), "Input receiver changed before click")
    guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left), let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) else { throw Refusal(message: "Could not create native mouse events") }
    down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
    let after = frontPID()
    try need(after == frontBefore, "Foreground drift after input")
    print(String(data: try JSONSerialization.data(withJSONObject: ["clicked":label,"pid":before["pid"]!,"windowId":before["windowId"]!,"bounds":b,"words":before["words"]!,"frontPid":after]), encoding: .utf8)!)
}
do { try main() } catch { fputs("pill-input: \(error)\n", stderr); exit(1) }
