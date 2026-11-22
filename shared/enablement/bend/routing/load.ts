import { readFileSync } from "node:fs";
import { bendDirectory, parseManifest } from "../manifest.ts";
import {
  declarationPath,
  declaredOwners,
  parseConsumers,
  routingTargets,
} from "./declarations.ts";

const routes = declaredOwners.map((owner) => {
  const read = (path: string) =>
    readFileSync(new URL("../../../../" + path, import.meta.url), "utf8");
  const manifest = bendDirectory(owner) + "/modules.json";
  const declaration = declarationPath(owner);
  const { modules } = parseManifest(owner, read(manifest));
  const match = parseConsumers(owner, read(declaration), modules);
  const moduleTargets = [...new Set(modules.flatMap((path) => match(path)!))];
  return (path: string) => {
    if (path === declaration) return routingTargets;
    if (path === manifest) return moduleTargets;
    return match(path);
  };
});

export function declaredConsumers(path: string) {
  for (const route of routes) {
    const targets = route(path);
    if (targets) return targets;
  }
}
