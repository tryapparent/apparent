export const portableSettings = new Set(
  [
    "storage.tsx",
    "retention.tsx",
    "connect-settings.tsx",
    "error-reporting.tsx",
    "reference.tsx",
  ].map((name) => "capture/desktop/ui/frontend/src/" + name),
);

const portal = "capture/desktop/linux/capture/portal.rs";
const linuxAdapters = new Set([
  "capture/desktop/linux/integration/appearance.rs",
]);
const linuxDoc = "capture/desktop/docs/linux/linux.md";

export function macPlatformDecision(
  paths: string[] | null,
  nonModifications: string[] | null,
  {
    documentationOnlyPath,
    needsPlatform,
    linuxDrivers,
  }: {
    documentationOnlyPath(path: string): boolean;
    needsPlatform(paths: string[]): boolean;
    linuxDrivers: ReadonlySet<string>;
  },
) {
  if (paths === null || nonModifications === null)
    return { macos: true, reasons: ["mac:unknown-history"] };
  if (!paths.length) return { macos: true, reasons: ["mac:empty-delta"] };
  const reasons = paths.map((path) => {
    if (nonModifications.includes(path))
      return "mac:unsupported-change:" + path;
    if (documentationOnlyPath(path)) return "docs:reviewed-prose:" + path;
    if (!needsPlatform([path])) return "owner:portable:" + path;
    if (linuxAdapters.has(path)) return "linux:reviewed-adapter:" + path;
    if (linuxDrivers.has(path)) return "linux:reviewed-test-driver:" + path;
    if (portableSettings.has(path)) return "linux:reviewed-settings:" + path;
    if (path === portal || path === linuxDoc)
      return "linux:reviewed-portal-input:" + path;
    return "mac:unproven-input:" + path;
  });
  for (const path of nonModifications)
    if (!paths.includes(path)) reasons.push("mac:unsupported-change:" + path);
  return {
    macos: reasons.some((reason) => reason.startsWith("mac:")),
    reasons,
  };
}
