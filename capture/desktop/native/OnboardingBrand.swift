import AppKit
import CoreText
import SwiftUI

/// Brand roles shared only by onboarding permission guidance and its test installer.
/// Popup silhouettes and frog artwork/motion are intentional user-approved exceptions.
enum OnboardingBrand {
  static let paper = NSColor(srgbRed: 245.0/255.0, green: 240.0/255.0, blue: 232.0/255.0, alpha: 1)
  static let carbon = NSColor(srgbRed: 2.0/255.0, green: 1.0/255.0, blue: 2.0/255.0, alpha: 1)
  static let lilac = Color(red: 183.0/255.0, green: 165.0/255.0, blue: 216.0/255.0)
  static let signal = Color(red: 122.0/255.0, green: 88.0/255.0, blue: 199.0/255.0)
  static let success = Color(red: 20.0/255.0, green: 107.0/255.0, blue: 67.0/255.0)
  static let failure = Color(red: 180.0/255.0, green: 35.0/255.0, blue: 24.0/255.0)
  static let backgroundNS = NSColor(name: nil) { appearance in
    appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? carbon : paper
  }
  static let foregroundNS = NSColor(name: nil) { appearance in
    appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? paper : carbon
  }
  static var background: Color { Color(nsColor: backgroundNS) }
  static var foreground: Color { Color(nsColor: foregroundNS) }
  static func font(_ size: CGFloat, weight: Int = 400) -> Font {
    .custom("HostGrotesk_\(weight)wght", size: size)
  }
  static func loadFont() {
    let source = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().appending(path: "shared/assets/fonts/HostGrotesk-Variable.ttf")
    let url = Bundle.main.url(forResource: "HostGrotesk-Variable", withExtension: "ttf") ?? source
    CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
  }

  struct ActionStyle: ButtonStyle {
    var primary = false
    @Environment(\.isEnabled) private var enabled
    @Environment(\.isFocused) private var focused
    func makeBody(configuration: Configuration) -> some View {
      configuration.label.font(OnboardingBrand.font(18, weight: 500))
        .padding(.horizontal, 16).padding(.vertical, 8)
        .frame(minWidth: 44, minHeight: 44)
        .foregroundStyle(primary ? Color(nsColor: OnboardingBrand.paper) : OnboardingBrand.foreground)
        .background(primary ? OnboardingBrand.signal : OnboardingBrand.background)
        .overlay(Rectangle().stroke(focused ? OnboardingBrand.signal : OnboardingBrand.foreground, lineWidth: focused ? 2 : 1))
        .opacity(enabled ? 1 : 0.45)
        .contentShape(Rectangle())
    }
  }
}
