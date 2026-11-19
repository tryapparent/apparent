import { sharedBendInput } from "./manifest.ts";

export function bendConsumers(path: string) {
  if (path === "shared/enablement/bend/consumers.ts")
    return ["tooling"] as const;
  if (
    path === ".github/workflows/stream-handoff.yml" ||
    path === "handoff/enablement/ci/bend/check.ts"
  )
    return [];
  if (/^(handoff|composition\/handoff)\//.test(path) && !path.endsWith(".md"))
    return ["capture", "desktop"] as const;
  if (sharedBendInput(path))
    return ["capture", "desktop", "service", "onboarding"] as const;
  if (path.startsWith("record/enablement/ci/bend/"))
    return /\/(?:build\.ts|modules\.json)$/.test(path)
      ? (["capture", "desktop", "onboarding"] as const)
      : [];
  if (path.startsWith("record/completion/") && path.endsWith(".bend"))
    return ["capture", "desktop", "onboarding"] as const;
  if (
    path === ".github/workflows/stream-record.yml" ||
    path === "connect/enablement/ci/bend/check.ts"
  )
    return [];
  if (path.startsWith("connect/enablement/ci/bend/"))
    return ["service"] as const;
}
