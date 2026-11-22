import type { Receipt } from "./score.ts";
import { audit, contractHash } from "./score.ts";

export type Part = Partial<Pick<Receipt, "waits" | "resources">> & {
  version: string;
};

export type RunIdentity = Pick<
  Receipt,
  "revision" | "runner" | "runId" | "vcpus"
>;

export function assemble(identity: RunIdentity, parts: Part[]) {
  if (!parts.length)
    throw new Error("At least one verified probe fragment is required");
  const waits = Object.create(null) as Receipt["waits"];
  const resources = Object.create(null) as Receipt["resources"];
  const stamp = /^apparent\s+\S+\s+·\s+([0-9a-f]{7,40})$/;
  for (const part of parts) {
    const revision = stamp.exec(part.version)?.[1];
    if (!revision || !identity.revision.startsWith(revision)) {
      throw new Error(
        "Probe fragment came from a different or modified application build",
      );
    }
    for (const [id, value] of Object.entries(part.waits ?? {})) {
      if (Object.hasOwn(waits, id))
        throw new Error("Conflicting wait proof for " + id);
      waits[id] = value;
    }
    for (const [id, value] of Object.entries(part.resources ?? {})) {
      if (Object.hasOwn(resources, id))
        throw new Error("Conflicting resource proof for " + id);
      resources[id] = value;
    }
  }
  const receipt = { ...identity, contractHash, waits, resources };
  return { receipt, coverage: audit(receipt) };
}
