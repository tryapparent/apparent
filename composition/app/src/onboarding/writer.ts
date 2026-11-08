/** GUI73f6's Progress::save uses the config-native retirement fence. This is a
 * writer-version compatibility check, never live ownership/retirement proof. */
export function hasReviewedOnboardingWriter(executableSha256: string): boolean {
  return executableSha256 === '2dbee5bcc778eb02c724ab3b9169f95784c976a54baaf75ca5042d08ea02bea2';
}
