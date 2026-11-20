import { readFile } from "node:fs/promises";
import { connections, Transport } from "./transport";
import type { T3Environment } from "../settings/t3-contract";
import policy from "../pure/t3-settings.mjs";

const icons = ["server", "cloud", "linux", "desktop", "laptop", "mac-mini", "mac-studio"];

export async function settingsEnvironments(configPath: string): Promise<T3Environment[]> {
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  const results = await Promise.allSettled(connections(saved.t3).map(async connection => {
    const config = await new Transport(connection).rpc("server.getConfig", {}) as {
      environment?: { label?: unknown; platform?: { machine?: unknown } };
      settings?: { environmentIcon?: unknown };
    };
    const label = config.environment?.label;
    const icon = policy.environment_icon(
      icons.indexOf(String(config.settings?.environmentIcon)) + 1,
      icons.indexOf(String(config.environment?.platform?.machine)) + 1,
    );
    return {
      origin: connection.origin,
      name: typeof label === "string" ? label.trim().slice(0, 160) : "",
      icon: icons[icon - 1] ?? "server",
    };
  }));
  return results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
}
