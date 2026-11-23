import Carbon.HIToolbox
import AppKit

enum ShortcutKeys {
  static func carbon(_ flags: NSEvent.ModifierFlags) -> Int {
    var bits = 0
    if flags.contains(.command) { bits |= cmdKey }
    if flags.contains(.shift) { bits |= shiftKey }
    if flags.contains(.option) { bits |= optionKey }
    if flags.contains(.control) { bits |= controlKey }
    return bits
  }

  /// Whether macOS has this combination as one of its enabled shortcuts (Keyboard Shortcuts).
  static func reserved(keyCode: Int, modifiers: Int) -> Bool {
    // Fn is observed without suppressing it, so any macOS Fn/Globe action remains active too.
    if [Int(kVK_Function), 58, 61].contains(keyCode) && modifiers == 0 { return false }
    var unmanaged: Unmanaged<CFArray>?
    guard CopySymbolicHotKeys(&unmanaged) == noErr,
          let hotkeys = unmanaged?.takeRetainedValue() as? [[String: Any]]
    else { return true }
    let mask = cmdKey | shiftKey | optionKey | controlKey
    return hotkeys.contains { hotkey in
      (hotkey[kHISymbolicHotKeyEnabled as String] as? Bool) == true
        && (hotkey[kHISymbolicHotKeyCode as String] as? Int) == keyCode
        && ((hotkey[kHISymbolicHotKeyModifiers as String] as? Int) ?? -1) & mask == modifiers
    }
  }
}


// Native physical gesture evidence only; selection validation remains with the provider.
struct OptionKeyGesture {
  private var candidate: UInt16?
  mutating func reset() { candidate = nil }
  mutating func observe(_ event: NSEvent) -> Bool {
    guard event.type == .flagsChanged, [UInt16(58), UInt16(61)].contains(event.keyCode) else {
      candidate = nil; return false
    }
    let otherKey = (0..<128).contains { key in
      key != Int(event.keyCode) && (CGEventSource.keyState(.combinedSessionState, key: CGKeyCode(key)) || CGEventSource.keyState(.hidSystemState, key: CGKeyCode(key)))
    }
    let mixed = !event.modifierFlags.intersection([.command, .control, .shift, .function]).isEmpty
    if mixed || otherKey || NSEvent.pressedMouseButtons != 0 { candidate = nil; return false }
    if event.modifierFlags.contains(.option) { candidate = event.keyCode; return false }
    let selected = candidate == event.keyCode
    candidate = nil
    return selected
  }
}
