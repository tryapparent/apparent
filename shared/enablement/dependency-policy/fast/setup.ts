import { Snapshot, git } from "../snapshot.ts";
import { lintConfigs, plan } from "./run.ts";
import { typechecks } from "./typecheck.ts";

const args = process.argv.slice(2);
if (
  !args.includes("--staged") ||
  args.some((arg) => !["--staged", "--all"].includes(arg))
)
  throw Error(
    "Usage: node shared/enablement/dependency-policy/fast/setup.ts --staged [--all]",
  );
const cwd = git(["rev-parse", "--show-toplevel"], process.cwd()).trim();
const tree = git(["write-tree"], cwd).trim();
const head = git(["rev-parse", "HEAD"], cwd).trim();
const changed = git(
  ["diff", "--name-only", "--no-renames", "-z", head, tree],
  cwd,
)
  .split("\0")
  .filter(Boolean);
const staged = new Snapshot(cwd, tree);
await typechecks(
  {
    cwd,
    tree,
    committed: new Snapshot(cwd, head),
    staged,
    changed,
  },
  {
    setup: true,
    all: args.includes("--all"),
    lintConfigs: lintConfigs(plan(staged, changed)),
  },
);
