import {
  readSetupStatus,
  readShellSetupStatus,
  setupStatusCommand,
  type LocalRoute,
  type SetupStatus,
} from "./controller.ts";

type Route = LocalRoute & { mode: string };
type Owner = Pick<LocalRoute, "profile" | "connectionId">;
type SetupHost = {
  requestProfile<T>(
    route: Route,
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T>;
  profileRoutes(): Promise<Route[]>;
  notify(notice: {
    id?: string;
    kind: "info" | "error";
    message: string;
    durationMs?: number;
    placement?: "default";
    action?: { label: string; onClick: () => void };
  }): void;
  state: {
    focusedSessionOwner?: { get(): Owner | null };
    focusedSessionId?: { get(): string | null };
    focusedStoredSessionId?: { get(): string | null };
  };
};
type ShellContract = { mode: "canonical" | "legacy"; hidden: boolean };

function sameRoute(candidate: Route, route: Route) {
  return (
    candidate.connectionId === route.connectionId &&
    candidate.profile === route.profile &&
    candidate.targetProfile === route.targetProfile &&
    candidate.mode === route.mode
  );
}

const setupActions = {
  setup_required: {
    label: "Open Apparent setup",
    message:
      "Finish setting up Apparent, then click Record with Apparent again.",
  },
  missing: {
    label: "Install Apparent",
    message: "Install the Apparent app on this computer to record from Hermes.",
  },
  update_required: {
    label: "Update Apparent",
    message: "Update the Apparent app on this computer to record from Hermes.",
  },
  unavailable: {
    label: "Open Apparent",
    message:
      "Hermes could not check Apparent setup. Open the app, then try again.",
  },
};

const setupOpenCommand = `case "$(uname -s)" in Darwin) /usr/bin/open 'apparent://open';; Linux) apparent launch apparent://open </dev/null >/dev/null 2>&1 & ;; *) exit 64;; esac`;

const unsupportedMethod = (error: unknown) => {
  const value = error as { code?: unknown; data?: { reason?: unknown } } | null;
  return value?.code === -32601 || value?.data?.reason === "unknown_method";
};
async function shellContract(
  host: SetupHost,
  route: Route,
): Promise<ShellContract> {
  try {
    const described = await host.requestProfile<{
      capabilities?: unknown;
      session_create?: { sources?: unknown; parameters?: unknown };
    }>(route, "runtime.describe", {});
    const create = described?.session_create;
    if (
      !Array.isArray(described?.capabilities) ||
      !Array.isArray(create?.sources) ||
      !Array.isArray(create?.parameters) ||
      !create.sources.includes("gui") ||
      !create.parameters.includes("request_id") ||
      !create.parameters.includes("source")
    )
      throw new Error(
        "Hermes returned an incomplete canonical runtime contract.",
      );
    return { mode: "canonical", hidden: create.parameters.includes("hidden") };
  } catch (error) {
    if (unsupportedMethod(error)) return { mode: "legacy", hidden: false };
    throw error;
  }
}

async function recorderStatus(
  host: SetupHost,
  route: Route,
  localSession: string | null,
): Promise<SetupStatus> {
  try {
    return readSetupStatus(
      await host.requestProfile(
        route,
        "plugin.apparent.setup_status",
        {},
        7000,
      ),
    );
  } catch (error) {
    if (!unsupportedMethod(error)) return "unavailable";
  }
  try {
    const contract = await shellContract(host, route);
    if (contract.mode === "canonical" && !localSession) return "legacy";
    const params =
      contract.mode === "canonical"
        ? { session_id: localSession, command: setupStatusCommand }
        : { command: setupStatusCommand };
    return readShellSetupStatus(
      await host.requestProfile(route, "shell.exec", params, 7000),
    );
  } catch {
    return "unavailable";
  }
}

export function createRecorderSetup(
  host: SetupHost,
  checking: { set(value: boolean): void },
  ctx: { os?: { openExternal: (url: string) => Promise<boolean> } },
  disposed: () => boolean,
) {
  function offerSetup(
    status: keyof typeof setupActions,
    route: Route,
    localSession: string | null,
  ) {
    const action = setupActions[status];
    host.notify({
      id: "apparent-recorder-setup",
      kind: "info",
      durationMs: 0,
      message: action.message,
      action: {
        label: action.label,
        onClick: () => {
          if (disposed()) return;
          if (status === "missing" || status === "update_required")
            void openDownload();
          else void openSetup(route, localSession);
        },
      },
    });
  }

  async function openDownload() {
    try {
      if (await ctx.os?.openExternal("https://app.tryapparent.com/")) return;
    } catch {}
    if (!disposed())
      host.notify({
        kind: "error",
        message: "Open app.tryapparent.com to get Apparent, then try again.",
      });
  }

  function showSetupInstructions() {
    host.notify({
      id: "apparent-recorder-setup",
      kind: "info",
      durationMs: 0,
      placement: "default",
      message:
        "Open Apparent from your app launcher to finish setup, then click Record with Apparent again.",
    });
  }

  async function openSetup(route: Route, localSession: string | null) {
    try {
      const contract = await shellContract(host, route);
      const routes = await host.profileRoutes();
      if (disposed()) return;
      const session = host.state.focusedSessionId?.get();
      const owner = host.state.focusedSessionOwner?.get();
      if (
        routes.some((candidate) => sameRoute(candidate, route)) &&
        (contract.mode === "legacy" ||
          (localSession &&
            session === localSession &&
            owner?.connectionId === route.connectionId &&
            owner.profile === route.profile))
      ) {
        const params =
          contract.mode === "canonical"
            ? { session_id: localSession, command: setupOpenCommand }
            : { command: setupOpenCommand };
        const result = await host.requestProfile<{ code?: number }>(
          route,
          "shell.exec",
          params,
          7000,
        );
        if (result?.code === 0) return;
      }
    } catch {}
    if (!disposed()) showSetupInstructions();
  }

  async function check(
    localRoute: Route,
    destination: Route,
    session: string | null,
    storedSession: string | null,
    owner: Owner,
  ) {
    checking.set(true);
    const localSession = localRoute === destination ? session : null;
    const status = await recorderStatus(host, localRoute, localSession);
    const manualOpen =
      (status === "setup_required" || status === "unavailable") &&
      !localSession &&
      (await shellContract(host, localRoute).catch(() => null))?.mode !==
        "legacy";
    checking.set(false);
    const routes = await host.profileRoutes();
    const focused = host.state.focusedSessionOwner?.get();
    const stillAvailable = (route: Route) =>
      routes.some((candidate) => sameRoute(candidate, route));
    if (
      disposed() ||
      (host.state.focusedSessionId?.get() || null) !== session ||
      (host.state.focusedStoredSessionId?.get() || null) !== storedSession ||
      focused?.connectionId !== owner.connectionId ||
      focused?.profile !== owner.profile ||
      !stillAvailable(localRoute) ||
      !stillAvailable(destination)
    ) {
      throw new Error(
        "The destination changed while checking setup. Nothing was started.",
      );
    }
    if (status === "ready" || status === "legacy") return true;
    if (manualOpen) showSetupInstructions();
    else offerSetup(status, localRoute, localSession);
    return false;
  }

  return { check, shellContract: (route: Route) => shellContract(host, route) };
}
