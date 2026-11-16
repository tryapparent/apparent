// Validate the key pair before publishing an update which installed apps cannot verify.
import CryptoKit
import Foundation

let environment = ProcessInfo.processInfo.environment
guard let secretText = environment["SPARKLE_PREVIEW_PRIVATE_KEY"],
      let publicText = environment["SPARKLE_PREVIEW_PUBLIC_KEY"],
      let secret = Data(base64Encoded: secretText),
      let publicKey = Data(base64Encoded: publicText), publicKey.count == 32 else {
    fatalError("Missing or malformed preview Sparkle key pair")
}

let derivedPublicKey: Data
if secret.count == 32 {
    guard let privateKey = try? Curve25519.Signing.PrivateKey(rawRepresentation: secret) else {
        fatalError("Invalid preview Sparkle seed")
    }
    derivedPublicKey = privateKey.publicKey.rawRepresentation
} else if secret.count == 96 {
    derivedPublicKey = Data(secret.suffix(32))
} else {
    fatalError("Preview Sparkle private key must be a 32-byte seed or 96-byte legacy key")
}
guard derivedPublicKey == publicKey else {
    fatalError("Preview Sparkle public key does not match the signing key")
}
