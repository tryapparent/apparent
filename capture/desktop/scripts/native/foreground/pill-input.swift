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
final class ClickTrace {
    let fd: Int32
    private var failure: String?
    private let started = ProcessInfo.processInfo.systemUptime
    init(_ url: URL) throws {
        fd = url.path.withCString { open($0, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, mode_t(0o600)) }
        guard fd >= 0 else { throw Refusal(message: "Could not create exclusive private click trace") }
    }
    func add(_ fields: [String: Any]) {
        guard failure == nil else { return }
        var timedFields = fields
        timedFields["elapsedMs"] = (ProcessInfo.processInfo.systemUptime - started) * 1000
        guard let data = try? JSONSerialization.data(withJSONObject: timedFields, options: [.sortedKeys]) else {
            failure = "Could not encode private click trace"; return
        }
        var bytes = data + Data([10]); bytes.withUnsafeMutableBytes { ptr in
            guard let base = ptr.baseAddress else { return }
            var offset = 0
            while offset < ptr.count {
                let n = write(fd, base.advanced(by: offset), ptr.count - offset)
                if n < 0 && errno == EINTR { continue }
                if n <= 0 { failure = "Could not write complete private click trace"; break }
                offset += n
            }
        }
    }
    func requireComplete() throws { if let failure { throw Refusal(message: failure) } }
    deinit { _ = close(fd) }
}
var clickTrace: ClickTrace?
var clickTraceName: String?
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
func currentPill(_ req: [String: Any], _ expected: Pill) throws -> Pill {
    let (current, _) = try pill(req)
    try need(current.pid == expected.pid && current.id == expected.id && current.rect == expected.rect,
        "Pill window identity or bounds changed")
    return current
}
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
func ownedWindows(_ req: [String: Any]) throws -> (rows: [[String: Any]], descendants: Set<pid_t>, electron: String) {
    let app = req["app"] as! String, root = pid_t(req["rootPid"] as! Int)
    let expectedRoot = (env["HOME"] ?? "") + "/Applications/"
    let exact = expectedRoot + "Apparent-Storage-\(env["GITHUB_RUN_ID"] ?? "")-\(env["GITHUB_RUN_ATTEMPT"] ?? "").app"
    try need(app == exact, "App bundle is not the exact run-attempt app path")
    let appURL = URL(fileURLWithPath: app).standardizedFileURL
    try need(!lstatIsLink(appURL.path) && exactExe(root, app + "/Contents/MacOS/apparent"), "Root PID does not map to requested app")
    let descendants = try ancestry(root)
    let electron = app + "/Contents/Resources/settings/runtime/Electron.app/Contents/MacOS/Electron"
    let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return (rows.filter { descendants.contains($0[kCGWindowOwnerPID as String] as? Int32 ?? -1) }, descendants, electron)
}
func launchSettings(_ owned: (rows: [[String: Any]], descendants: Set<pid_t>, electron: String)) -> [[String: Any]] {
    owned.rows.compactMap { row in
        guard let owner = row[kCGWindowOwnerPID as String] as? Int32,
              let title = row[kCGWindowName as String] as? String, title.hasPrefix("Apparent Settings"),
              (row[kCGWindowAlpha as String] as? Double ?? 0) > 0,
              let id = row[kCGWindowNumber as String] as? UInt32, exactExe(owner, owned.electron) else { return nil }
        return ["pid": Int(owner), "windowId": Int(id), "title": String(title.prefix(128))]
    }
}
func closeLaunchSettings(_ req: [String: Any]) throws -> [String: Any] {
    let owned = try ownedWindows(req), settings = launchSettings(owned)
    try need(settings.count == 1, "Expected one owned launch Settings window before Close")
    let target = settings[0], pid = pid_t(target["pid"] as! Int)
    try need(target["title"] as? String == "Apparent Settings — About" &&
        target["pid"] as? Int == req["settingsPid"] as? Int &&
        target["windowId"] as? Int == req["settingsWindowId"] as? Int, "Launch Settings identity changed before Close")
    let application = AXUIElementCreateApplication(pid)
    try need(AXUIElementSetMessagingTimeout(application, 0.2) == .success, "Could not bound Settings AX messaging")
    var rawWindows: CFTypeRef?
    try need(AXUIElementCopyAttributeValue(application, kAXWindowsAttribute as CFString, &rawWindows) == .success,
        "Owned Settings AX windows unavailable")
    guard let windows = rawWindows as? [AXUIElement], windows.count == 1 else { throw Refusal(message: "Owned Settings AX window is ambiguous") }
    var title: CFTypeRef?, rawButton: CFTypeRef?
    try need(AXUIElementCopyAttributeValue(windows[0], kAXTitleAttribute as CFString, &title) == .success &&
        title as? String == "Apparent Settings — About", "Owned Settings AX title differs")
    try need(AXUIElementCopyAttributeValue(windows[0], kAXCloseButtonAttribute as CFString, &rawButton) == .success,
        "Owned Settings Close button unavailable")
    guard let rawButton, CFGetTypeID(rawButton) == AXUIElementGetTypeID() else { throw Refusal(message: "Settings Close is not an AX element") }
    let button = rawButton as! AXUIElement
    var buttonPid: pid_t = -1
    try need(AXUIElementGetPid(button, &buttonPid) == .success && buttonPid == pid, "Settings Close belongs to another process")
    let fresh = try ownedWindows(req)
    let current = launchSettings(fresh)
    try need(current.count == 1 && current[0]["pid"] as? Int == target["pid"] as? Int &&
        current[0]["windowId"] as? Int == target["windowId"] as? Int && current[0]["title"] as? String == target["title"] as? String &&
        exactExe(pid, fresh.electron), "Launch Settings changed before native dismissal")
    try withinBudget()
    // One native Close only. An ambiguous result fails; the caller never retries.
    try need(AXUIElementPerformAction(button, kAXPressAction as CFString) == .success, "Native Settings Close failed; outcome unknown")
    while kill(pid, 0) == 0 {
        try withinBudget()
        RunLoop.main.run(until: Date().addingTimeInterval(0.025))
    }
    try need(errno == ESRCH, "Could not verify owned Settings child exit")
    try need(launchSettings(try ownedWindows(req)).isEmpty, "Settings remained visible after Close")
    return ["closedSettings": target, "frontPid": Int(frontPID())]
}
func pill(_ req: [String: Any]) throws -> (Pill, Set<pid_t>) {
    let owned = try ownedWindows(req)
    let matches: [Pill] = owned.rows.compactMap { row in
        guard let owner = row[kCGWindowOwnerPID as String] as? Int32,
              row[kCGWindowName as String] as? String == "Apparent recording controls",
              (row[kCGWindowAlpha as String] as? Double ?? 0) > 0,
              let id = row[kCGWindowNumber as String] as? UInt32,
              let d = row[kCGWindowBounds as String] as? [String: Any], let rect = CGRect(dictionaryRepresentation: d as CFDictionary),
              exactExe(owner, owned.electron) else { return nil }
        return Pill(pid: owner, id: id, rect: rect)
    }
    if matches.count != 1 {
        let candidates = owned.rows.prefix(12).map { row in
            ["pid": row[kCGWindowOwnerPID as String] ?? -1,
             "id": row[kCGWindowNumber as String] ?? -1,
             "title": String((row[kCGWindowName as String] as? String ?? "<unavailable>").prefix(128))] as [String: Any]
        }
        let details = String(data: try JSONSerialization.data(withJSONObject: candidates), encoding: .utf8) ?? "[]"
        throw Refusal(message: "Expected exactly one visible mapped pill; owned candidates=" + details)
    }
    return (matches[0], owned.descendants)
}
struct Word { let text: String; let box: CGRect; let candidate: VNRecognizedText }
func observe(_ req: [String: Any], _ png: URL) throws -> ([String: Any], [Word], Set<pid_t>) {
    let (w, _) = try pill(req)
    _ = try run("/usr/sbin/screencapture", ["-x", "-o", "-l", String(w.id), png.path], 3)
    var imageStat = stat(); try need(png.path.withCString({ lstat($0, &imageStat) }) == 0 && (imageStat.st_mode & S_IFMT) == S_IFREG, "Window screenshot output is not a regular file")
    guard let image = NSBitmapImageRep(data: try Data(contentsOf: png)), image.pixelsWide > 0, image.pixelsHigh > 0 else {
        throw Refusal(message: "Could not read screenshot pixel dimensions")
    }
    let (afterShot, _) = try pill(req)
    try need(afterShot.pid == w.pid && afterShot.id == w.id && afterShot.rect == w.rect, "Pill window changed during screenshot")
    let vr = VNRecognizeTextRequest(); vr.recognitionLevel = .accurate; vr.usesLanguageCorrection = false
    try VNImageRequestHandler(url: png).perform([vr]); try withinBudget()
    let words = (vr.results ?? []).compactMap { o -> Word? in guard let c = o.topCandidates(1).first else { return nil }; return Word(text: c.string, box: o.boundingBox, candidate: c) }
    let front = frontPID()
    let pillDescendants = try ancestry(w.pid)
    let geometry: [String: Any] = ["pixelWidth": image.pixelsWide, "pixelHeight": image.pixelsHigh,
        "windowBounds": [w.rect.minX,w.rect.minY,w.rect.width,w.rect.height],
        "pixelToPointX": Double(w.rect.width) / Double(image.pixelsWide),
        "pixelToPointY": Double(w.rect.height) / Double(image.pixelsHigh)]
    return (["pid": Int(w.pid), "windowId": Int(w.id), "bounds": [w.rect.minX,w.rect.minY,w.rect.width,w.rect.height], "geometry": geometry, "words": words.map { ["text":$0.text,"box":[$0.box.minX,$0.box.minY,$0.box.width,$0.box.height]] as [String:Any] }, "frontPid": Int(front)], words, pillDescendants)
}

func admitPillAccessibility(_ pill: Pill) throws {
    try withinBudget()
    let application = AXUIElementCreateApplication(pill.pid)
    try need(AXUIElementSetMessagingTimeout(application, 0.2) == .success, "Could not bound pill accessibility admission")
    // Electron exposes its renderer tree on demand to native assistive clients.
    // The caller has already verified this exact owned pill and executable.
    let result = AXUIElementSetAttributeValue(application, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    clickTrace?.add(["stage":"accessibilityAdmission", "pid":Int(pill.pid), "windowId":Int(pill.id), "result":result.rawValue])
    try need(result == .success, "Owned Electron accessibility admission failed")
    try withinBudget()
}

func buttonIdentity(_ element: AXUIElement, label: String, point: CGPoint, descendants: Set<pid_t>) throws -> [String: Any]? {
    var current = element
    for depth in 0..<5 {
        try withinBudget()
        try need(AXUIElementSetMessagingTimeout(current, 0.2) == .success, "Could not bound receiver AX messaging")
        var pid: pid_t = -1
        try need(AXUIElementGetPid(current, &pid) == .success && descendants.contains(pid), "Input receiver is not owned by the pill renderer")
        var rawRole: CFTypeRef?, rawTitle: CFTypeRef?, rawDescription: CFTypeRef?
        try need(AXUIElementCopyAttributeValue(current, kAXRoleAttribute as CFString, &rawRole) == .success,
            "Input receiver role unavailable")
        _ = AXUIElementCopyAttributeValue(current, kAXTitleAttribute as CFString, &rawTitle)
        _ = AXUIElementCopyAttributeValue(current, kAXDescriptionAttribute as CFString, &rawDescription)
        let role = rawRole as? String ?? ""
        let title = (rawTitle as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let description = (rawDescription as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let knownLabels = ["Finish", "Copy link", "Cancel upload", "Retry upload", "Paste", "Inspect"]
        clickTrace?.add(["stage":"receiverObserved", "depth":depth, "requestedLabel":label, "pid":Int(pid), "role":String(role.prefix(80)), "title":knownLabels.contains(title) ? title : "<other>", "description":knownLabels.contains(description) ? description : "<other>"])
        if role == (kAXButtonRole as String) && (title == label || description == label) {
            var rawPosition: CFTypeRef?, rawSize: CFTypeRef?
            try need(AXUIElementCopyAttributeValue(current, kAXPositionAttribute as CFString, &rawPosition) == .success &&
                AXUIElementCopyAttributeValue(current, kAXSizeAttribute as CFString, &rawSize) == .success,
                "Requested button geometry unavailable")
            guard let rawPosition, let rawSize, CFGetTypeID(rawPosition) == AXValueGetTypeID(),
                  CFGetTypeID(rawSize) == AXValueGetTypeID() else { throw Refusal(message: "Requested button geometry has invalid types") }
            let positionValue = rawPosition as! AXValue, sizeValue = rawSize as! AXValue
            var position = CGPoint.zero, size = CGSize.zero
            try need(AXValueGetType(positionValue) == .cgPoint && AXValueGetValue(positionValue, .cgPoint, &position) &&
                AXValueGetType(sizeValue) == .cgSize && AXValueGetValue(sizeValue, .cgSize, &size),
                "Could not read requested button geometry")
            let bounds = CGRect(origin: position, size: size)
            clickTrace?.add(["stage":"buttonGeometry", "pid":Int(pid), "label":label,
                "bounds":[bounds.minX,bounds.minY,bounds.width,bounds.height], "point":[point.x,point.y]])
            // AX supplies an independent physical target check. A stable image
            // scale alone cannot establish that OCR maps to this exact button.
            try need(position.x.isFinite && position.y.isFinite && size.width.isFinite && size.height.isFinite &&
                size.width > 0 && size.height > 0 && bounds.contains(point), "OCR point is outside the exact requested native button")
            return ["pid": Int(pid), "role": role, "title": title == label ? label : "", "description": description == label ? label : "",
                "bounds":[bounds.minX,bounds.minY,bounds.width,bounds.height]]
        }
        var rawParent: CFTypeRef?
        guard AXUIElementCopyAttributeValue(current, kAXParentAttribute as CFString, &rawParent) == .success,
              let rawParent, CFGetTypeID(rawParent) == AXUIElementGetTypeID() else { break }
        current = rawParent as! AXUIElement
    }
    return nil
}

func ownedAccessibilityButton(_ expected: Pill, label: String, point: CGPoint, descendants: Set<pid_t>) throws -> [String: Any]? {
    func children(_ element: AXUIElement, _ attribute: String, limit: Int) throws -> [AXUIElement] {
        var count: CFIndex = 0
        let result = AXUIElementGetAttributeValueCount(element, attribute as CFString, &count)
        if result == .attributeUnsupported || result == .noValue { return [] }
        try need(result == .success && count >= 0 && count <= limit, "Owned accessibility tree exceeds its bound or is unavailable")
        if count == 0 { return [] }
        var raw: CFArray?
        try need(AXUIElementCopyAttributeValues(element, attribute as CFString, 0, count, &raw) == .success,
            "Could not read bounded owned accessibility children")
        guard let values = raw as? [AXUIElement], values.count == count else { throw Refusal(message: "Invalid owned accessibility children") }
        return values
    }
    let application = AXUIElementCreateApplication(expected.pid)
    try need(AXUIElementSetMessagingTimeout(application, 0.2) == .success, "Could not bound owned accessibility tree")
    var queue = try children(application, kAXWindowsAttribute, limit: 4).map { ($0, 0) }
    var seen: [AXUIElement] = [], matches: [[String: Any]] = []
    while !queue.isEmpty {
        try withinBudget()
        let (element, depth) = queue.removeFirst()
        if seen.contains(where: { CFEqual($0, element) }) { continue }
        // The total element bound also bounds depth. Electron's native wrappers
        // and the production renderer can put an ordinary button below level 12.
        try need(seen.count < 128, "Owned accessibility tree exceeds its traversal bound")
        seen.append(element)
        clickTrace?.add(["stage":"accessibilityTreeElement", "depth":depth, "visited":seen.count])
        var pid: pid_t = -1
        try need(AXUIElementGetPid(element, &pid) == .success && descendants.contains(pid), "Accessibility tree contains an unowned receiver")
        try need(AXUIElementSetMessagingTimeout(element, 0.2) == .success, "Could not bound owned accessibility element")
        var role: CFTypeRef?
        try need(AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role) == .success, "Owned accessibility role unavailable")
        if depth == 0 {
            var title: CFTypeRef?, position: CFTypeRef?, size: CFTypeRef?
            _ = AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &title)
            guard pid == expected.pid, role as? String == (kAXWindowRole as String), title as? String == "Apparent recording controls" else { continue }
            try need(AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &position) == .success &&
                AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &size) == .success, "Owned pill accessibility geometry unavailable")
            guard let position, let size, CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { throw Refusal(message: "Invalid owned pill accessibility geometry") }
            let p = position as! AXValue, s = size as! AXValue
            var origin = CGPoint.zero, dimensions = CGSize.zero
            try need(AXValueGetType(p) == .cgPoint && AXValueGetValue(p, .cgPoint, &origin) &&
                AXValueGetType(s) == .cgSize && AXValueGetValue(s, .cgSize, &dimensions) &&
                CGRect(origin: origin, size: dimensions) == expected.rect, "Owned accessibility window differs from mapped pill")
        }
        if role as? String == (kAXButtonRole as String),
           let identity = try buttonIdentity(element, label: label, point: point, descendants: descendants) { matches.append(identity) }
        let next = try children(element, kAXChildrenAttribute, limit: 128 - seen.count - queue.count)
        queue.append(contentsOf: next.map { ($0, depth + 1) })
    }
    try need(matches.count <= 1, "Owned accessibility button is ambiguous")
    return matches.first
}

func preparePillAccessibility(_ req: [String: Any], _ expected: Pill, label: String, point: CGPoint, descendants: Set<pid_t>) throws -> [String: Any] {
    _ = try currentPill(req, expected)
    let frontBefore = frontPID()
    try admitPillAccessibility(expected)
    // Electron 45 debounces this request for two seconds. A read-only bootstrap
    // uses the helper's existing eight-second budget; input keeps its 1.5s cap.
    while true {
        try withinBudget()
        // Before hover the native panel is intentionally click-through. Tree
        // readiness is not a physical-hit assertion; click checks that separately.
        if let identity = try ownedAccessibilityButton(expected, label: label, point: point, descendants: descendants) {
                _ = try currentPill(req, expected)
                try need(frontPID() == frontBefore, "Foreground drift during accessibility bootstrap")
                try withinBudget()
                try clickTrace?.requireComplete()
                clickTrace?.add(["stage":"accessibilityReady", "receiver":identity])
                try clickTrace?.requireComplete()
                return identity
        }
        Thread.sleep(forTimeInterval: 0.025)
    }
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
    try need(["snapshot", "prepare", "click", "startup", "close-settings"].contains(op), "Unknown operation")
    if op == "prepare" { try need(["Finish", "Copy link"].contains(req["label"] as? String ?? ""), "Unsupported accessibility bootstrap label") }
    if op == "click" { try need(["Copy link", "Cancel upload", "Retry upload"].contains(req["label"] as? String ?? ""), "Unsupported click label") }
    try safeOwnedPath(out, root: runner)
    try need(!fm.fileExists(atPath: out.path), "Output must be fresh")
    let job = reqURL.deletingLastPathComponent(); jobDir = job
    var js = stat(); try need(job.path.hasPrefix(runner.path + "/") && !lstatIsLink(job.path) && job.pathComponents.count == runner.pathComponents.count + 1 && job.path.withCString({ lstat($0, &js) }) == 0 && js.st_uid == getuid() && js.st_mode & 0o777 == 0o700, "Job directory must be private, owned and directly under RUNNER_TEMP")
    try safeOwnedPath(out, root: job)
    try need(st.st_uid == getuid(), "Request file must be owned by current user")
    if op == "startup" {
        let settings = launchSettings(try ownedWindows(req))
        let observed: [String: Any] = ["settings": settings, "frontPid": Int(frontPID())]
        print(String(data: try JSONSerialization.data(withJSONObject: observed), encoding: .utf8)!); return
    }
    if op == "close-settings" {
        let closed = try closeLaunchSettings(req)
        print(String(data: try JSONSerialization.data(withJSONObject: closed), encoding: .utf8)!); return
    }
    if op == "click" || op == "prepare" {
        let traceURL = job.appendingPathComponent("pill-input-\(getpid()).log")
        try safeOwnedPath(traceURL, root: runner)
        clickTrace = try ClickTrace(traceURL)
        clickTraceName = traceURL.lastPathComponent
    }
    let (before, words, pillDescendants) = try observe(req, out)
    if op == "snapshot" { print(String(data: try JSONSerialization.data(withJSONObject: before), encoding: .utf8)!); return }
    try need(op == "click" || op == "prepare", "Unknown operation")
    let label = req["label"] as! String; try need((op == "prepare" ? ["Finish", "Copy link"] : ["Copy link", "Cancel upload", "Retry upload"]).contains(label), "Unsupported operation label")
    let matching = try words.compactMap { word -> CGRect? in guard let range = word.text.range(of: label) else { return nil }; return try word.candidate.boundingBox(for: range)?.boundingBox }
    try need(matching.count == 1, "Label OCR match is missing or ambiguous")
    let b = before["bounds"] as! [CGFloat], box = matching[0]
    try need(box.minX >= 0 && box.minY >= 0 && box.maxX <= 1 && box.maxY <= 1 && box.width > 0 && box.height > 0, "OCR target outside owned image")
    let point = CGPoint(x: b[0] + box.midX*b[2], y: b[1] + (1-box.midY)*b[3])
    guard let trace = clickTrace else { throw Refusal(message: "Click trace unavailable") }
    let initialPill = try pill(req).0
    try need(Int(initialPill.pid) == (before["pid"] as! Int) && Int(initialPill.id) == (before["windowId"] as! Int) &&
        [initialPill.rect.minX,initialPill.rect.minY,initialPill.rect.width,initialPill.rect.height] == b, "Pill changed before accessibility admission")
    if let preparedPid = req["preparedPid"] {
        try need(preparedPid is Int && (preparedPid as! Int) == Int(initialPill.pid), "Prepared accessibility belongs to another pill PID")
    }
    if op == "prepare" {
        try need(frontPID() == pid_t(before["frontPid"] as! Int), "Foreground drift before accessibility bootstrap")
        let identity = try preparePillAccessibility(req, initialPill, label: label, point: point, descendants: pillDescendants)
        let receipt: [String: Any] = ["prepared":true,"pid":Int(initialPill.pid),"windowId":Int(initialPill.id),"button":identity,"frontPid":Int(frontPID()),"trace":clickTraceName!]
        let encoded = try JSONSerialization.data(withJSONObject: receipt)
        print(String(data: encoded, encoding: .utf8)!)
        return
    }
    trace.add(["stage":"beforeMove", "frontPid":Int(frontPID()), "pillPid":Int(initialPill.pid), "windowId":Int(initialPill.id), "bounds":[initialPill.rect.minX,initialPill.rect.minY,initialPill.rect.width,initialPill.rect.height], "geometry":before["geometry"]!, "point":[point.x,point.y]])
    try trace.requireComplete()
    try need(frontPID() == pid_t(before["frontPid"] as! Int), "Foreground drift before pointer movement")
    let ax = AXUIElementCreateSystemWide(); _ = AXUIElementSetMessagingTimeout(ax, 0.2)
    let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)
    try need(move != nil, "Could not create native mouse movement")
    move!.post(tap: .cghidEventTap)
    trace.add(["stage":"postMove", "frontPid":Int(frontPID()), "point":[point.x,point.y]])
    let started = ProcessInfo.processInfo.systemUptime
    var hitIdentity: [String: Any]?
    while ProcessInfo.processInfo.systemUptime - started < 1.5 {
        var target: AXUIElement?; let err = AXUIElementCopyElementAtPosition(ax, Float(point.x), Float(point.y), &target)
        if err == .success, let target {
            var p: pid_t = -1; let pidResult = AXUIElementGetPid(target, &p)
            trace.add(["stage":"inputHit", "pid":Int(p), "result":pidResult.rawValue])
            if pidResult == .success && pillDescendants.contains(p), let identity = try buttonIdentity(target, label: label, point: point, descendants: pillDescendants) {
                hitIdentity = identity; break
            }
        } else if err != .cannotComplete && err != .noValue { throw Refusal(message: "AX input hit observation failed") }
        Thread.sleep(forTimeInterval: 0.025)
    }
    guard let hitIdentity else { throw Refusal(message: "Input receiver has no exact requested button in its bounded parent chain") }
    try need(ProcessInfo.processInfo.systemUptime - started < 1.5, "Exact native button arrived after the input-readiness deadline")
    trace.add(["stage":"ownedHit", "frontPid":Int(frontPID()), "receiver":hitIdentity])
    let frontBefore = frontPID()
    try need(frontBefore == pid_t(before["frontPid"] as! Int), "Foreground drift before input")
    let fresh = out.deletingLastPathComponent().appendingPathComponent("reobserve-\(getpid()).png")
    try safeOwnedPath(fresh, root: runner); try need(!fm.fileExists(atPath: fresh.path), "Re-observation output is not fresh")
    let (again, _, _) = try observe(req, fresh)
    try withinBudget()
    try need((again["windowId"] as! Int) == (before["windowId"] as! Int) && (again["bounds"] as! [CGFloat]) == b, "Pill window changed before input")
    try need((again["geometry"] as! [String: Any]) as NSDictionary == (before["geometry"] as! [String: Any]) as NSDictionary, "Screenshot geometry changed before input")
    try need((frontPID()) == frontBefore, "Foreground drift before click")
    var finalTarget: AXUIElement?
    try need(AXUIElementCopyElementAtPosition(ax, Float(point.x), Float(point.y), &finalTarget) == .success, "Final input receiver unavailable")
    guard let finalTarget else { throw Refusal(message: "Final input receiver unavailable") }
    guard let finalIdentity = try buttonIdentity(finalTarget, label: label, point: point, descendants: pillDescendants) else {
        throw Refusal(message: "Exact requested native button disappeared before click")
    }
    try need(finalIdentity as NSDictionary == hitIdentity as NSDictionary, "Input receiver changed before click")
    let verified = try currentPill(req, initialPill)
    let preDownFront = frontPID()
    trace.add(["stage":"preDown", "frontPid":Int(preDownFront), "receiver":finalIdentity, "pillPid":Int(verified.pid), "windowId":Int(verified.id), "bounds":[verified.rect.minX,verified.rect.minY,verified.rect.width,verified.rect.height], "point":[point.x,point.y]])
    try need(preDownFront == frontBefore, "Foreground drift before click")
    try trace.requireComplete()
    try withinBudget()
    guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left), let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) else { throw Refusal(message: "Could not create native mouse events") }
    down.post(tap: .cghidEventTap)
    // Release immediately: no file I/O, run-loop wait or throwing guard may
    // strand a pressed pointer between these two native events.
    let afterDownCached = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1
    up.post(tap: .cghidEventTap)
    let after = frontPID()
    trace.add(["stage":"afterDownCached", "frontPid":Int(afterDownCached), "receiver":finalIdentity])
    trace.add(["stage":"afterUp", "frontPid":Int(after), "receiver":finalIdentity])
    try need(after == frontBefore, "Foreground drift after input")
    try trace.requireComplete()
    let receipt: [String: Any] = ["clicked":label,"pid":before["pid"]!,"windowId":before["windowId"]!,"bounds":b,"geometry":before["geometry"]!,"words":before["words"]!,"frontPid":after,"trace":clickTraceName!]
    let encoded = try JSONSerialization.data(withJSONObject: receipt)
    print(String(data: encoded, encoding: .utf8)!)
}
do { try main() } catch {
    clickTrace?.add(["stage":"failure", "message":String(String(describing:error).prefix(240))])
    fputs("pill-input: \(error)\n", stderr); exit(1)
}
