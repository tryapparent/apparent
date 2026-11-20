import policy from "../pure/worktree-base.mjs";
import type { Transport } from "./transport.ts";

type Ref = { name: string; isDefault: boolean; isRemote?: boolean };
type RefPage = { isRepo: boolean; refs: Ref[]; nextCursor?: number | null };

export async function worktreeStrategy(transport: Transport, cwd: unknown) {
  let best: Ref | undefined;
  let priority = policy.base_priority(false, false, false, false);
  let cursor = 0;
  for (;;) {
    const page = (await transport.rpc("vcs.listRefs", {
      cwd,
      limit: 100,
      cursor,
      includeMatchingRemoteRefs: true,
    })) as RefPage;
    if (!page.isRepo) return { type: "root" };
    for (const ref of page.refs) {
      const remote = ref.isRemote === true;
      const rank = policy.base_priority(
        ref.isDefault,
        remote,
        ref.name === (remote ? "origin/main" : "main"),
        ref.name === (remote ? "origin/master" : "master"),
      );
      if (rank < priority) {
        best = ref;
        priority = rank;
      }
    }
    if (policy.base_resolved(priority) || page.nextCursor == null) break;
    if (page.nextCursor <= cursor) throw Error("Invalid T3 ref cursor");
    cursor = page.nextCursor;
  }
  if (!best) throw Error("T3 project has no default branch");
  return {
    type: "worktree",
    baseRef: best.name,
    startFromOrigin: best.isRemote === true,
  };
}
