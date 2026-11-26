export const recordVerificationManifest = "record/enablement/verification.json";
export const recordPerformanceVerifierTest =
  "record/enablement/ci/performance/verify.test.ts";
export const recordPerformanceTests = [
  "record/enablement/performance/fixtures/host-accounting.test.ts",
  "record/enablement/performance/fixtures/smt-subset.test.ts",
  "record/enablement/performance/local/stop-timeline.test.ts",
  "record/enablement/performance/native/start-spans.test.ts",
  "record/enablement/performance/score/compare.test.ts",
];
export const performanceVerificationInputs = new Set([
  recordVerificationManifest,
  ...recordPerformanceTests,
  "record/enablement/ci/performance/verify.ts",
  recordPerformanceVerifierTest,
]);
export const settingsVerificationInputs = new Set([
  "record/enablement/ci/settings/verify.ts",
  "record/enablement/settings/package.json",
  "record/enablement/settings/recording-fixture.ts",
  "record/enablement/settings/recording-fixture.test.ts",
]);

export const recordOnlyInputs = new Set([
  ...performanceVerificationInputs,
  ...settingsVerificationInputs,
  "record/capture-request/test/lifecycle.test.ts",
  "record/capture-request/test/admission-cases.ts",
  "record/enablement/ci/bend/capture-request/check.ts",
]);
