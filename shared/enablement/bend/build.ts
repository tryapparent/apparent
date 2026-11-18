import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import type { BendOwner } from "./manifest.ts";
import { ownerManifest, regularFile } from "./owners.ts";
import { prepareBend, provisionLean, run } from "./toolchain.ts";

export async function bendScratch<T>(
  action: (directory: string) => Promise<T>,
): Promise<T> {
  const scratch = mkdtempSync(
    join(process.env.RUNNER_TEMP ?? tmpdir(), "apparent-dev-bend-"),
  );
  try {
    return await action(scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function proofOptions(args: string[]) {
  if (args.length === 0) return {};
  if (args.length === 1 && args[0] === "--proof") return { provision: true };
  if (args.length === 2 && args[0] === "--lean-bin" && isAbsolute(args[1]))
    return { leanDirectory: args[1] };
  throw new Error("Expected --proof or --lean-bin /absolute/path/to/lean/bin");
}

export async function buildBend(
  root: string,
  owner: BendOwner,
  destination: string,
  proof?: ReturnType<typeof proofOptions>,
): Promise<void> {
  const manifest = ownerManifest(root, owner);
  if (!manifest) throw new Error(`Missing Bend manifest for ${owner}`);
  if (!manifest.modules.length) return;
  for (const source of manifest.modules)
    if (!regularFile(root, source))
      throw new Error(
        `Bend source must be a regular non-executable file: ${source}`,
      );

  await bendScratch(async (scratch) => {
    const leanDirectory = proof?.provision
      ? await provisionLean(scratch)
      : proof?.leanDirectory;
    const compile = await prepareBend(
      scratch,
      proof ? { runtime: "bun", leanDirectory } : { runtime: "node" },
    );
    mkdirSync(destination, { recursive: true });
    const staging = mkdtempSync(join(destination, ".bend-"));
    try {
      const outputs = [];
      for (const source of manifest.modules) {
        const output = basename(source, ".bend") + ".mjs";
        compile(join(root, source), join(staging, output));
        run(process.execPath, ["--check", output], staging);
        if (proof) {
          run(
            process.execPath,
            [
              "--input-type=module",
              "-e",
              `await import(${JSON.stringify("./" + output)})`,
            ],
            staging,
          );
          console.log(
            `Bend ${leanDirectory ? "kernel verdict" : "type and law check"} and module build passed for ${source}`,
          );
        }
        outputs.push(output);
      }
      for (const output of outputs)
        renameSync(join(staging, output), join(destination, output));
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });
}
