import { execFileSync } from "node:child_process";
import { versionPattern } from "./manifest.ts";

export function compareVersions(a: string, b: string): number {
  if (!versionPattern.test(a) || !versionPattern.test(b))
    throw Error("Numeric versions required");
  const left = a.split(".").map(BigInt),
    right = b.split(".").map(BigInt);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
export function cargoVersion(source: string): string {
  const cargo = execFileSync("git", ["show", `${source}:Cargo.toml`], {
    encoding: "utf8",
  });
  const section =
    cargo.match(/^\[package\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1] ?? "";
  const versions = [...section.matchAll(/^version\s*=\s*"([^"]+)"\s*$/gm)];
  if (versions.length !== 1 || !versionPattern.test(versions[0][1]))
    throw Error("Numeric Cargo package version required");
  return versions[0][1];
}
