import { readFile } from "node:fs/promises";
import { connections, type Connection } from "./transport.ts";

export type PickerPreferences = { enabled: boolean; configured: Connection[] };

export async function readPickerPreferences(
  configFile: string,
): Promise<PickerPreferences> {
  try {
    const saved = JSON.parse(await readFile(configFile, "utf8"));
    if (saved.experiments?.t3DestinationPicker === true) {
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
