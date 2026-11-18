import { sharedBendInput } from "./manifest.ts";

export function bendConsumers(path: string) {
  if (sharedBendInput(path))
    return ["capture", "desktop", "onboarding"] as const;
  if (path.startsWith("record/enablement/ci/bend/"))
    return /\/(?:build\.ts|modules\.json)$/.test(path)
      ? (["capture", "desktop", "onboarding"] as const)
      : [];
  if (path.startsWith("record/completion/") && path.endsWith(".bend"))
    return ["capture", "desktop", "onboarding"] as const;
  if (path === ".github/workflows/stream-record.yml") return [];
}
