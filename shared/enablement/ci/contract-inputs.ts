import { serviceOnlyInputs } from "./connect-inputs.ts";
import { sparklePolicyBuild, sparklePolicySource } from "../bend/consumers.ts";
import { sharedBendInput } from "../bend/manifest.ts";

const all = {
  contract_engineering: true,
  contract_release: true,
  contract_theme: true,
  contract_workflow: true,
  contract_tooling: true,
  contract_sparkle: true,
};
const engineeringFixtures = new Set([
  "capture/desktop/ui/frontend/package.json",
  "capture/desktop/ui/frontend/src/hermes/runtime.smoke.ts",
  "capture/desktop/ui/frontend/tests/foreground/mac.ts",
  "capture/desktop/ui/frontend/tests/notes/smoke.cjs",
  "capture/desktop/ui/frontend/tests/pill/foreground/smoke.cts",
  "connect/client/typescript/src/transfer/contract.ts",
  ...serviceOnlyInputs,
  "connect/service/src/worker.ts",
  "shared/ui/package.json",
]);

export function contractChecks(
  paths: string[] | null,
  tooling: boolean,
  storage: boolean,
) {
  if (!paths?.length) return all;
  const has = (pattern: RegExp) => paths.some((path) => pattern.test(path));
  const workflow = has(/^\.github\//);
  const sharedVerifier = has(
    /^enablement\/(?:ci\/|local-tests\/|prerequisites\/|verification\.py$)|^shared\/enablement\//,
  );
  const nativeBuild = has(
    /^(?:Cargo\.(?:toml|lock)$|\.cargo\/|build\.rs$|enablement\/native-build\/)/,
  );
  const engineering =
    tooling ||
    workflow ||
    sharedVerifier ||
    nativeBuild ||
    storage ||
    paths.some((path) => engineeringFixtures.has(path)) ||
    has(
      /^AGENTS\.md$|^\.githooks\/|^enablement\/[^/]+\.(?:py|ts)$|^capture\/(?:desktop|agent)\/scripts\//,
    ) ||
    has(
      /^(?:connect|engine|onboarding)\/enablement\/ci\/|^public\/enablement\//,
    );
  const release =
    sharedVerifier ||
    nativeBuild ||
    has(
      /^\.github\/(?:workflows|actions)\/|^composition\/enablement\/release\/|^enablement\/release_gate\.py$/,
    ) ||
    has(
      /^capture\/desktop\/(?:scripts\/(?:packaging|release|linux\/appimage)\/|ui\/frontend\/(?:package(?:-lock)?\.json$|scripts\/))/,
    );
  const theme =
    has(/^shared\/ui\/scripts\//) ||
    paths.some(
      (path) =>
        /^(?:capture|connect|public|shared)\/.*\.(?:css|tsx|ts|html|js|cjs)$/.test(
          path,
        ) &&
        !/(?:^|\/)(?:test|tests|scripts|enablement|node_modules)\//.test(path),
    );
  return {
    contract_engineering: engineering,
    contract_release: release,
    contract_theme: theme,
    contract_workflow: workflow,
    contract_tooling: tooling,
    contract_sparkle: paths.some(
      (path) =>
        path === sparklePolicySource ||
        path.startsWith(sparklePolicyBuild) ||
        sharedBendInput(path),
    ),
  };
}
