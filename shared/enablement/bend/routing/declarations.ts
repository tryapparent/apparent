import { bendDirectory, type BendOwner } from "../manifest.ts";

export const declaredOwners = ["connect", "handoff"] as const;
export const routingTargets = [
  "capture",
  "desktop",
  "client",
  "service",
  "web",
  "onboarding",
] as const;
type Target = (typeof routingTargets)[number];

export function declarationPath(owner: BendOwner) {
  return bendDirectory(owner) + "/consumers.json";
}

export function parseConsumers(
  owner: BendOwner,
  json: string,
  modules: string[],
) {
  const values = JSON.parse(json);
  const rules = new Map<string, Target[]>();
  if (!values || Array.isArray(values) || typeof values !== "object")
    throw Error("Expected consumer path map for " + owner);
  for (const [path, targets] of Object.entries(values)) {
    const scoped =
      path.startsWith(owner + "/") ||
      path.startsWith("composition/" + owner + "/") ||
      path === ".github/workflows/stream-" + owner + ".yml";
    if (
      !scoped ||
      !/^(?:[\w.-]+\/)*[\w.-]+\/?$/.test(path) ||
      path.split("/").some((part) => part === "." || part === "..")
    )
      throw Error("Invalid consumer path " + path);
    if (
      !Array.isArray(targets) ||
      targets.some((target) => !routingTargets.includes(target)) ||
      new Set(targets).size !== targets.length
    )
      throw Error("Invalid consumer targets for " + path);
    if (
      !targets.length &&
      path !== bendDirectory(owner) + "/check.ts" &&
      path !== ".github/workflows/stream-" + owner + ".yml"
    )
      throw Error("Empty consumers for " + path);
    rules.set(path, targets);
  }
  const prefixes = [...rules.keys()]
    .filter((path) => path.endsWith("/"))
    .sort((a, b) => b.length - a.length);
  function match(path: string) {
    const exact = rules.get(path);
    if (exact || path.endsWith(".md")) return exact;
    const prefix = prefixes.find((prefix) => path.startsWith(prefix));
    return prefix ? rules.get(prefix) : undefined;
  }
  for (const path of modules)
    if (!match(path)?.length) throw Error("Missing consumers for " + path);
  return match;
}
