import { sharedBendInput } from "./manifest.ts";

export const sparklePolicySource = "shared/analytics/sparkle-outcomes.bend";
export const sparklePolicyBuild = "shared/enablement/ci/bend/";

export function bendConsumers(path: string) {
  if (
    path === "shared/enablement/bend/consumers.ts" ||
    /^enablement\/ci\/bend\/(?:build\.ts|check\.ts|modules\.json)$/.test(path)
  )
    return ["tooling"] as const;
  if (
    path === sparklePolicySource ||
    (path.startsWith(sparklePolicyBuild) && !path.endsWith("/check.ts"))
  )
    return ["capture", "desktop"] as const;
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
    path.startsWith("composition/settings/about/") ||
    /^composition\/enablement\/ci\/bend\/(?:build\.ts|modules\.json)$/.test(
      path,
    )
  )
    return ["capture", "desktop"] as const;
  if (
    path.startsWith("record/notes/") ||
    path === "record/enablement/ci/bend/note-gesture.ts"
  )
    return ["capture", "desktop"] as const;
  if (path.startsWith("record/pill/renderer/"))
    return path.endsWith(".md") ? [] : (["desktop", "onboarding"] as const);
  if (
    /^record\/pill\/(?:pill-state\.bend|host\.ts|presentation\.ts)$/.test(
      path,
    ) ||
    path === "record/enablement/ci/bend/pill.ts"
  )
    return ["capture", "desktop"] as const;
  if (path.startsWith("record/enablement/ci/pill/")) return [] as const;
  if (
    path === "record/capture-request/src/capture-admission.bend" ||
    path === "record/enablement/ci/bend/capture-request/capture-admission.ts"
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
