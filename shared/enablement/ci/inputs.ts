import { spawnSync } from "node:child_process";

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

export function admissionConsumersKnown(cwd: string, head: string): boolean {
  const result = spawnSync(
    "git",
    [
      "grep",
      "-I",
      "-l",
      "-E",
      "[.]githooks/pre-commit|enablement/directory-width|shared/enablement/(dependency-policy|ci|issues)|@apparent/dependency-policy",
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
