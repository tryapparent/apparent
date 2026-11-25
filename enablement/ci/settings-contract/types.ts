import type { Preference } from "./catalog.ts";

export const typesPath = "shared/settings/preference-ids.ts";

export function renderPreferenceIds(
  preferences: readonly Preference[],
): string {
  const fields = preferences.map(({ id, kind, nullable }) => {
    const type =
      kind === "object"
        ? "Record<string, unknown>"
        : kind === "integer"
          ? "number"
          : kind;
    return `  ${JSON.stringify(id)}: ${type}${nullable ? " | null" : ""};`;
  });
  return `export type PreferenceValues = {\n${fields.join("\n")}\n};\n\nexport type RegisteredPreferenceId = keyof PreferenceValues;\n`;
}
