import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const panes = [
  "general",
  "recording",
  "handoff",
  "storage",
  "permissions",
  "agents",
  "labs",
  "about",
] as const;

export const catalogPaths = [
  "record/settings/preferences.json",
  "handoff/settings/preferences.json",
  "agent/settings/preferences.json",
  "onboarding/settings/preferences.json",
  "composition/settings/preferences.json",
  "connect/settings/preferences.json",
] as const;

const platforms = new Set(["macos", "linux", "wayland"]);
const kinds = ["boolean", "string", "integer", "number", "object"] as const;
const fields = new Set([
  "id",
  "pane",
  "label",
  "kind",
  "default",
  "apply",
  "legacy",
  "nullable",
  "platforms",
  "choices",
  "min",
  "max",
  "effect",
]);

type Kind = (typeof kinds)[number];

export type Preference = {
  id: string;
  pane?: (typeof panes)[number];
  label: string;
  kind: Kind;
  default: unknown;
  apply: string;
  legacy?: { path: string; invert?: boolean; lenient?: boolean };
  nullable?: boolean;
  platforms?: string[];
  choices?: unknown[];
  min?: number;
  max?: number;
  effect?: string;
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function typed(value: unknown, kind: Kind, nullable: boolean): boolean {
  if (value === null) return nullable;
  if (kind === "integer") return Number.isSafeInteger(value);
  if (kind === "number")
    return typeof value === "number" && Number.isFinite(value);
  if (kind === "object") return object(value);
  return typeof value === kind;
}

export function validateSample(entry: Preference, sample: unknown): boolean {
  return (
    typed(sample, entry.kind, entry.nullable === true) &&
    (entry.choices === undefined || entry.choices.includes(sample)) &&
    (typeof sample !== "number" ||
      ((entry.min === undefined || sample >= entry.min) &&
        (entry.max === undefined || sample <= entry.max)))
  );
}

function preference(value: unknown, location: string): Preference {
  function check(valid: unknown, message: string): asserts valid {
    if (!valid) throw Error(`${location}: ${message}`);
  }
  if (!object(value)) throw Error(`${location}: expected a preference object`);
  const {
    id,
    pane,
    label,
    kind,
    apply,
    legacy,
    nullable,
    platforms: supported,
    choices,
    min,
    max,
    effect,
  } = value;
  check(
    Object.keys(value).every((field) => fields.has(field)),
    "unknown preference field",
  );
  check(
    typeof id === "string" &&
      /^[a-z]+\.[a-z][A-Za-z0-9]*$/.test(id) &&
      panes.some((pane) => id.startsWith(pane + ".")),
    "invalid preference ID or pane",
  );
  check(
    pane === undefined || panes.includes(pane as (typeof panes)[number]),
    "invalid presentation pane",
  );
  check(
    typeof label === "string" && label.trim() === label && label.length,
    "missing label",
  );
  check(kinds.includes(kind as Kind), "invalid value kind");
  check(
    typeof apply === "string" && /^[a-z][a-z0-9-]*$/.test(apply),
    "invalid application timing",
  );
  check(
    nullable === undefined || typeof nullable === "boolean",
    "nullable must be a boolean",
  );
  check(
    effect === undefined ||
      (typeof effect === "string" && /^[a-z][A-Za-z0-9-]*$/.test(effect)),
    "invalid effect",
  );
  check(
    supported === undefined ||
      (Array.isArray(supported) &&
        supported.length &&
        new Set(supported).size === supported.length &&
        supported.every((entry) => platforms.has(entry))),
    "invalid platforms",
  );
  check(
    legacy === undefined ||
      (object(legacy) &&
        Object.keys(legacy).every((key) =>
          ["path", "invert", "lenient"].includes(key),
        ) &&
        typeof legacy.path === "string" &&
        /^[A-Za-z][\w-]*(\.[A-Za-z][\w-]*)?$/.test(legacy.path) &&
        [legacy.invert, legacy.lenient].every(
          (flag) =>
            flag === undefined ||
            (kind === "boolean" && typeof flag === "boolean"),
        )),
    "invalid legacy alias",
  );
  for (const limit of [min, max])
    check(
      limit === undefined ||
        ((kind === "integer" || kind === "number") &&
          typed(limit, kind, false)),
      "invalid numeric limit",
    );
  check(
    min === undefined || max === undefined || Number(min) <= Number(max),
    "minimum exceeds maximum",
  );
  const valid = (entry: unknown) =>
    typed(entry, kind as Kind, nullable === true) &&
    (typeof entry !== "number" ||
      ((min === undefined || entry >= Number(min)) &&
        (max === undefined || entry <= Number(max))));
  if (choices !== undefined)
    check(
      Array.isArray(choices) &&
        choices.length &&
        kind !== "object" &&
        new Set(choices).size === choices.length &&
        choices.every(valid),
      "invalid choices",
    );
  check(
    "default" in value &&
      (value.default === null ||
        (valid(value.default) &&
          (!Array.isArray(choices) || choices.includes(value.default)))),
    "invalid default",
  );
  return value as Preference;
}

export function validateCatalog(
  sources: Iterable<readonly [string, unknown]>,
  allowEmpty = false,
): Preference[] {
  const preferences = [...sources].flatMap(([path, entries]) => {
    if (!Array.isArray(entries)) throw Error(`${path}: expected an array`);
    return entries.map((entry, index) =>
      preference(entry, `${path} entry ${index + 1}`),
    );
  });
  if (!preferences.length && !allowEmpty)
    throw Error("Settings catalog is empty");
  const claimed = new Map<string, string>();
  const claim = (path: string, id: string) => {
    const owner = claimed.get(path);
    if (owner)
      throw Error(`Settings path ${path} is claimed by ${owner} and ${id}`);
    for (const [other, otherId] of claimed) {
      if (path.startsWith(`${other}.`) || other.startsWith(`${path}.`))
        throw Error(
          `Settings paths ${path} (${id}) and ${other} (${otherId}) overlap`,
        );
    }
    claimed.set(path, id);
  };
  for (const { id } of preferences) claim(id, id);
  for (const { id, legacy } of preferences) {
    if (legacy) claim(legacy.path, id);
  }
  const order = ({ id, pane }: Preference) =>
    panes.findIndex((name) => name === (pane ?? id.split(".")[0]));
  return preferences.sort((left, right) => order(left) - order(right));
}

export function loadCatalog(root: string, allowEmpty = false): Preference[] {
  return validateCatalog(
    catalogPaths.flatMap((path) => {
      const absolute = resolve(root, path);
      const file = lstatSync(absolute, { throwIfNoEntry: false });
      if (!file) return [];
      if (!file.isFile())
        throw Error(`${path}: expected a regular catalog file`);
      return [[path, JSON.parse(readFileSync(absolute, "utf8"))] as const];
    }),
    allowEmpty,
  );
}
