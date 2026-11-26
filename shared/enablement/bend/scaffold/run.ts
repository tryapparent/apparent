import {
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix } from "node:path";
import { parseArgs } from "node:util";
import { bendDirectory, bendOwners, parseManifest } from "../manifest.ts";
import { regularFile } from "../owners.ts";
import {
  declarationPath,
  declaredOwners,
  parseConsumers,
  routingTargets,
} from "../routing/declarations.ts";

const command = "node shared/enablement/bend/scaffold/run.ts";
const usage = `${command} <owner/path.bend> [--consumers <target,target>]`;
const starter = "import Base\n\ndef identity(value: U32) -> U32:\n  value\n";

function scaffold(path: string, consumers?: string) {
  const owner = bendOwners.find((owner) => path.startsWith(owner + "/"));
  if (!owner) throw Error("Choose a canonical owner with a Bend build.");
  const directory = bendDirectory(owner);
  const root = realpathSync(process.cwd());
  const check = directory + "/check.ts";
  const manifestPath = directory + "/modules.json";
  for (const entry of [manifestPath, directory + "/build.ts", check])
    if (!regularFile(root, entry))
      throw Error(
        `${entry} is missing or invalid. Choose an existing Bend owner.`,
      );
  const routing = declaredOwners.some((candidate) => candidate === owner);
  if (consumers !== undefined && !routing)
    throw Error(`--consumers applies only to ${declaredOwners.join(" and ")}.`);

  const manifestFile = join(root, manifestPath);
  const consumerFile = join(root, declarationPath(owner));
  const draft = join(root, directory, ".scaffold-lock");
  if (lstatSync(draft, { throwIfNoEntry: false }))
    throw Error(
      `${directory}/.scaffold-lock exists. Check for a running scaffold.`,
    );
  mkdirSync(draft);
  const sourceDraft = join(draft, "source");
  const manifestDraft = join(draft, "modules");
  const consumerDraft = join(draft, "consumers");
  const consumerBackup = join(draft, "consumers-before");
  let sourceAdded = false;
  let consumersUpdated = false;
  let destination = "";
  try {
    const previous = readFileSync(manifestFile, "utf8");
    const existing = parseManifest(owner, previous);
    const relative = path.slice(owner.length + 1);
    const manifest = JSON.parse(previous);
    manifest.modules.push(relative);
    const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
    const updated = json(manifest);
    const { modules } = parseManifest(owner, updated);
    destination = join(root, path);
    const parent = dirname(destination);
    if (realpathSync(parent) !== parent)
      throw Error(
        `${posix.dirname(path)} must be a real directory in the checkout.`,
      );
    if (lstatSync(destination, { throwIfNoEntry: false }))
      throw Error(`${path} already exists.`);

    let previousConsumers: string | undefined;
    if (routing) {
      if (!regularFile(root, declarationPath(owner)))
        throw Error(`Missing regular ${declarationPath(owner)}.`);
      previousConsumers = readFileSync(consumerFile, "utf8");
      const match = parseConsumers(owner, previousConsumers, existing.modules);
      if (consumers === undefined) {
        if (!match(path)?.length)
          throw Error(
            `No consumer route for ${path}. Pass --consumers with the affected targets.`,
          );
      } else {
        const routes = JSON.parse(previousConsumers);
        if (Object.hasOwn(routes, path))
          throw Error(
            `${path} already has a consumer route. Omit --consumers to use it.`,
          );
        routes[path] = consumers.split(",");
        const updatedConsumers = json(routes);
        parseConsumers(owner, updatedConsumers, modules);
        writeFileSync(consumerDraft, updatedConsumers);
        writeFileSync(consumerBackup, previousConsumers);
      }
    }
    writeFileSync(sourceDraft, starter);
    writeFileSync(manifestDraft, updated);
    if (
      readFileSync(manifestFile, "utf8") !== previous ||
      (previousConsumers !== undefined &&
        readFileSync(consumerFile, "utf8") !== previousConsumers)
    )
      throw Error(
        "Bend registration changed during scaffolding. Review it and retry.",
      );
    linkSync(sourceDraft, destination);
    sourceAdded = true;
    if (consumers !== undefined) {
      renameSync(consumerDraft, consumerFile);
      consumersUpdated = true;
    }
    renameSync(manifestDraft, manifestFile);
  } catch (error) {
    if (consumersUpdated) renameSync(consumerBackup, consumerFile);
    if (sourceAdded) unlinkSync(destination);
    throw error;
  } finally {
    for (const file of [
      sourceDraft,
      manifestDraft,
      consumerDraft,
      consumerBackup,
    ])
      if (lstatSync(file, { throwIfNoEntry: false })) unlinkSync(file);
    rmdirSync(draft);
  }
  console.log(`Created ${path}\nRegistered in ${manifestPath}`);
  if (consumers !== undefined)
    console.log(`Added a route in ${declarationPath(owner)}`);
  console.log(`Check with node ${check}`);
}

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      consumers: { type: "string" },
    },
  });
  if (values.help) {
    console.log(`Create and register a Bend2 starter in an existing source directory.

${usage}

Run from the repository root. Existing files are preserved.
Connect and Handoff use an existing consumer route when available.
Use --consumers for an exact route. Targets are ${routingTargets.join(", ")}.

Example
  ${command} record/completion/src/finish-admission.bend`);
  } else {
    if (positionals.length !== 1) throw Error(`Usage: ${usage}`);
    scaffold(positionals[0], values.consumers);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
