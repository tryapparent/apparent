import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bendDirectory,
  bendOwners,
  type BendOwner,
  parseManifest,
  sharedBendInput,
} from "./manifest.ts";

export function regularFile(root: string, path: string): boolean {
  let current = root;
  const parts = path.split("/");
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    if (!lstatSync(current, { throwIfNoEntry: false })?.isDirectory())
      return false;
  }
  const stat = lstatSync(join(current, parts.at(-1)!), {
    throwIfNoEntry: false,
  });
  return !!stat?.isFile() && (stat.mode & 0o111) === 0;
}

export function ownerManifest(root: string, owner: BendOwner) {
  const directory = bendDirectory(owner);
  const path = `${directory}/modules.json`;
  if (!regularFile(root, path)) return undefined;
  return parseManifest(owner, readFileSync(join(root, path), "utf8"));
}

export function affectedBendOwners(
  root: string,
  paths: string[] | null,
): BendOwner[] {
  return bendOwners.filter((owner) => {
    const manifest = ownerManifest(root, owner);
    if (!manifest?.modules.length) return false;
    return (
      !paths ||
      paths.some(
        (path) =>
          sharedBendInput(path) ||
          path === `.github/workflows/stream-${owner}.yml` ||
          path.startsWith(bendDirectory(owner) + "/") ||
          manifest.modules.includes(path) ||
          manifest.inputs.some((input) =>
            input.endsWith("/") ? path.startsWith(input) : path === input,
          ),
      )
    );
  });
}
