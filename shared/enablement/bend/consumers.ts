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
  if (
    path.startsWith("record/notes/") ||
    path === "record/enablement/ci/bend/note-gesture.ts"
  )
    return ["capture", "desktop"] as const;
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
  if (
    path.startsWith("onboarding/host/traversal/") ||
    path.startsWith("onboarding/host/tips/") ||
    /^onboarding\/package(?:-lock)?\.json$/.test(path) ||
    /^onboarding\/enablement\/ci\/(entry-policy\.ts|bend\/(build\.ts|native\.ts|note-tip\.ts|table\.ts|modules\.json))$/.test(
      path,
    )
  )
    return ["capture", "desktop", "onboarding"] as const;
  if (
    path === ".github/workflows/stream-onboarding.yml" ||
    path === "onboarding/enablement/ci/bend/check.ts" ||
    path === "onboarding/enablement/ci/pack.ts"
  )
    return ["onboarding"] as const;
  if (
    path === "connect/enablement/ci/bend/settings.ts" ||
    path === "connect/client/typescript/src/account/account-status.bend"
  )
    return ["capture", "desktop", "onboarding"] as const;
  if (path === "connect/enablement/ci/bend/modules.json")
    return ["capture", "desktop", "onboarding", "service"] as const;
  if (path.startsWith("connect/enablement/ci/bend/"))
    return ["service"] as const;
}
