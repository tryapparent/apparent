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
    action?: { label: string; onClick: () => void };
  }): void;
  state: {
    focusedSessionOwner?: { get(): Owner | null };
    focusedSessionId?: { get(): string | null };
    focusedStoredSessionId?: { get(): string | null };
  };
};
type ShellContract = { mode: "canonical" | "legacy"; hidden: boolean };

const setupActions = {
  setup_required: {
    label: "Open Apparent setup",
    message:
      "Finish setting up Apparent, then click Record with Apparent again.",
    url: "apparent://open",
  },
  missing: {
    label: "Install Apparent",
    message: "Install the Apparent app on this computer to record from Hermes.",
    url: "https://app.tryapparent.com/",
  },
  update_required: {
    label: "Update Apparent",
    message: "Update the Apparent app on this computer to record from Hermes.",
    url: "https://app.tryapparent.com/",
  },
  unavailable: {
    label: "Open Apparent",
    message:
      "Hermes could not check Apparent setup. Open the app, then try again.",
    url: "apparent://open",
  },
};

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
  function offerSetup(status: keyof typeof setupActions) {
    const action = setupActions[status];
    host.notify({
      id: "apparent-recorder-setup",
      kind: "info",
      durationMs: 0,
      message: action.message,
      action: {
        label: action.label,
        onClick: () => {
          if (!disposed()) void openSetup(action.url);
        },
      },
    });
  }

  async function openSetup(url: string) {
    try {
      if (await ctx.os?.openExternal(url)) return;
    } catch {}
    if (!disposed())
      host.notify({
        kind: "error",
        message:
          url === "apparent://open"
            ? "Open Apparent from your app launcher to finish setup, then try again."
            : "Open app.tryapparent.com to get Apparent, then try again.",
      });
  }

  async function check(
    localRoute: Route,
    destination: Route,
    session: string | null,
    storedSession: string | null,
    owner: Owner,
  ) {
    checking.set(true);
    const status = await recorderStatus(
      host,
      localRoute,
      localRoute === destination ? session : null,
    );
    checking.set(false);
    const routes = await host.profileRoutes();
    const focused = host.state.focusedSessionOwner?.get();
    const stillAvailable = (route: Route) =>
      routes.some(
        (candidate) =>
          candidate.connectionId === route.connectionId &&
          candidate.profile === route.profile &&
          candidate.targetProfile === route.targetProfile &&
          candidate.mode === route.mode,
      );
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
    offerSetup(status);
    return false;
  }

  return { check, shellContract: (route: Route) => shellContract(host, route) };
}
