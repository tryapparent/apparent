import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owner = fileURLToPath(new URL("../../", import.meta.url));
if (!process.argv[2]) throw Error("Provide a package output directory");
const output = resolve(process.argv[2]);
mkdirSync(output);
const manifest = JSON.parse(readFileSync(join(owner, "package.json"), "utf8"));
const { name, version, exports: entrypoints } = manifest;
if (
  name !== "@apparent/onboarding" ||
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
) {
  throw Error("Expected a versioned Onboarding package");
}
const [packed] = JSON.parse(
  execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", output],
    { cwd: owner, encoding: "utf8" },
  ),
);
if (
  packed.name !== name ||
  packed.version !== version ||
  packed.filename !== `apparent-onboarding-${version}.tgz`
)
  throw Error("Unexpected packed package identity");
const archive = join(output, packed.filename);
const consumer = mkdtempSync(join(tmpdir(), "apparent-dev-onboarding-pack-"));
try {
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  execFileSync(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      archive,
    ],
    { cwd: consumer, stdio: "inherit" },
  );
  const imports = Object.keys(entrypoints).map((key) => name + key.slice(1));
  const probe = `
    import assert from "node:assert/strict";
    import { PracticeHost } from "@apparent/onboarding/practice-host";
    import traversal from "@apparent/onboarding/traversal";
    for (const entry of ${JSON.stringify(imports)}) await import(entry);
    const shortcut = { $: "TourShortcut" };
    assert.deepEqual(traversal.back(shortcut, false, false), { $: "TourPermissions" });
    assert.deepEqual(traversal.back(shortcut, false, true), { $: "TourWelcome" });
    assert.deepEqual(traversal.primary(shortcut, true, true, true, false, false), { $: "TourStay" });
    assert.deepEqual(traversal.resume_capture({ $: "TourDone" }, true, false), { $: "TourTryIt" });
    const host = new PracticeHost();
    const result = host.accept({
      type: "practice-batch", version: 1, source: "1", transport: "1",
      attempt: "1", capture: "1", sequence: "1", intent: null, board: null,
      events: [{ type: "reset" }, { type: "started" }]
    });
    assert.equal(result.stage, "whiteboard");
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
    cwd: consumer,
    stdio: "inherit",
  });
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
const sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(
  join(output, `${packed.filename}.sha256`),
  `${sha256}  ${packed.filename}\n`,
);
writeFileSync(
  join(output, "package-receipt.json"),
  JSON.stringify({
    name,
    version,
    archive: packed.filename,
    sha256,
    source: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: owner,
      encoding: "utf8",
    }).trim(),
  }) + "\n",
);
