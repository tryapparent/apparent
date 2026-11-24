const sourceRoots =
  /^(?:agent|capture|composition|connect|engine|handoff|onboarding|record|shared)\//;
const sourceExtension = /\.(?:rs|[cm]?[jt]sx?)$/;
const evidence =
  /(?:^|\/)(?:enablement|test|tests|test_support|fixtures|docs)\/|\.(?:smoke|spec|test)\.[cm]?[jt]sx?$|(?:^|\/)[^/]*_tests\.rs$/;

export function preferenceSource(path: string): boolean {
  return (
    (path === "main.rs" || sourceRoots.test(path)) &&
    sourceExtension.test(path) &&
    !evidence.test(path)
  );
}

export function settingsContractRequired(paths: string[] | null): boolean {
  return (
    !paths?.length ||
    paths.some(
      (path) =>
        (sourceRoots.test(path) &&
          path.endsWith("/settings/preferences.json")) ||
        preferenceSource(path) ||
        (sourceRoots.test(path) && path.endsWith(".bend")) ||
        /^(?:shared\/settings\/|enablement\/ci\/(?:settings-contract\/|select\.ts$)|enablement\/local-tests\/(?:run|contracts|settings-contract\.test)\.ts$|shared\/enablement\/(?:dependency-policy\/|ci\/settings-inputs\.ts$)|\.github\/workflows\/checks\.yml$|build\.rs$)/.test(
          path,
        ),
    )
  );
}
