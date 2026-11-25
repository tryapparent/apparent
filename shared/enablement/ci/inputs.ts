import { spawnSync } from "node:child_process";
import { serviceOnlyInputs } from "./connect-inputs.ts";

export const nativeWorkflowPaths = [
  "checks",
  "linux-updater-harness",
  "release-linux",
  "release-mac-preview",
  "verification-platform",
  "verification",
].map((name) => `.github/workflows/${name}.yml`);

export const branchCleanupInput = (path: string) =>
  path === ".github/workflows/branch-cleanup.yml" ||
  path.startsWith("enablement/ci/branch-cleanup/");

export function admissionTooling(path: string): boolean {
  return (
    path === ".githooks/pre-commit" ||
    path.startsWith("enablement/directory-width/") ||
    path.startsWith("shared/enablement/dependency-policy/") ||
    path.startsWith("shared/enablement/ci/") ||
    path.startsWith("shared/enablement/issues/") ||
    path.startsWith("enablement/hooks/")
  );
}

export const codexStopHookTest =
  "enablement/hooks/make-it-apparent-stop.test.ts";

const codexStopHookInputs = new Set([
  "enablement/hooks/make-it-apparent-stop.ts",
  codexStopHookTest,
  "enablement/hooks/README.md",
]);

export function admissionConsumersKnown(
  cwd: string,
  head: string,
  changed: string[],
): boolean {
  const pattern = changed.every((path) => codexStopHookInputs.has(path))
    ? "enablement/hooks|make-it-apparent-stop"
    : "[.]githooks/pre-commit|enablement/directory-width|shared/enablement/(dependency-policy|ci|issues)|@apparent/dependency-policy|enablement/hooks|make-it-apparent-stop";
  const result = spawnSync(
    "git",
    [
      "grep",
      "-I",
      "-l",
      "-E",
      pattern,
      head,
      "--",
      "capture",
      "record",
      "onboarding",
      "handoff",
      "connect",
      "agent",
      "public",
      "hermes",
      "engine",
      "shared/ui",
      "shared/assets",
      "composition",
      ":!*.md",
      ":!package-lock.json",
    ],
    { cwd, encoding: "utf8" },
  );
  return !result.error && result.status === 1;
}
export function connectConsumers(path: string, native: boolean) {
  if (
    /^connect\/(?:settings\/|native-adapter\/|client\/typescript\/src\/account\/)/.test(
      path,
    ) ||
    path === "connect/enablement/ci/bend/settings.ts"
  )
    return ["desktop", "capture", "onboarding", "client"] as const;
  if (path === "connect/enablement/ci/build-client.ts")
    return ["capture", "client"] as const;
  if (path === "connect/enablement/ci/recipient-ffmpeg.ts")
    return ["service"] as const;
  if (!native && path.startsWith("connect/enablement/"))
    return [
      path === "connect/enablement/ci/verify-composition.ts"
        ? "web"
        : "tooling",
    ] as const;
  if (!native && path.startsWith("connect/web/")) return ["web"] as const;
  if (
    [
      "connect/client/typescript/src/mcp-wire.ts",
      "connect/client/typescript/src/transfer/contract.ts",
      "connect/client/typescript/contracts.ts",
    ].includes(path)
  )
    return ["client", "capture", "service"] as const;
  if (path.startsWith("connect/client/")) return ["client", "capture"] as const;
  if (serviceOnlyInputs.has(path)) return ["service", "web"] as const;
  if (!native && path.startsWith("connect/service/"))
    return ["service", "client", "web", "capture"] as const;
}
