import { readFile } from "node:fs/promises";
import policy from "../pure/t3-settings.mjs";
import preferences from "../settings/preferences.json" with { type: "json" };
import { connections, type Connection } from "./transport.ts";

export type PickerPreferences = { enabled: boolean; configured: Connection[] };

const picker = preferences.find(
  ({ id }) => id === "agents.t3DestinationPicker",
);
if (!picker) throw Error("Missing T3 picker preference");
const {
  id,
  legacy: { path: legacyPath },
  default: fallback,
} = picker;

function valueAt(root: unknown, preferencePath: string): unknown {
  let current = root;
  for (const key of preferencePath.split(".")) {
    if (
      !current ||
      typeof current !== "object" ||
      !Object.hasOwn(current, key)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export async function readPickerPreferences(
  configFile: string,
): Promise<PickerPreferences> {
  try {
    const saved = JSON.parse(await readFile(configFile, "utf8"));
    const pane = saved?.agents;
    if (
      pane !== undefined &&
      (!pane || typeof pane !== "object" || Array.isArray(pane))
    ) {
      return { enabled: false, configured: [] };
    }
    const canonical = valueAt(saved, id);
    const legacy = valueAt(saved, legacyPath);
    const expected = saved?.settingsCompatibility?.[id];
    const previousBuildEdited =
      typeof expected === "boolean" &&
      expected === canonical &&
      legacy !== expected;
    if (
      policy.picker_enabled(
        canonical !== undefined && !previousBuildEdited,
        typeof canonical === "boolean" ? canonical : fallback,
        typeof legacy === "boolean" ? legacy : fallback,
      )
    ) {
      const configured = connections(saved.t3).map(
        ({ origin, token, expiresAt, projectId }) => ({
          origin,
          token,
          expiresAt,
          projectId,
        }),
      );
      return { enabled: true, configured };
    }
  } catch {}
  return { enabled: false, configured: [] };
}
