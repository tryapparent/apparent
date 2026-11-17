import { createHash } from "node:crypto";
import {
  createReadStream,
  lstatSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type Manifest = {
  schemaVersion: 1;
  repository: string;
  sourceSha: string;
  version: string;
  tag: string;
  channel: "stable" | "main";
  platform: string;
  architecture: string;
  producer: {
    runId: string;
    runAttempt: number;
    workflow: string;
    controlSha: string;
  };
  evidence: { nativeChecks: boolean; signing: boolean; notarization: boolean };
  files: { name: string; sha256: string; size: number }[];
};
export const workflow = ".github/workflows/verification.yml";
export const repository = "tryapparent/apparent";
export const sha = /^[a-f0-9]{40}$/;
export const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function releaseTag(
  channel: string,
  version: string,
  source: string,
): string {
  if (channel === "stable") return `v${version}`;
  if (channel === "main") return `linux-main-v2-${source}`;
  throw Error("Unsupported paired release channel");
}
export async function digest(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export function identity(manifest: Manifest): void {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.repository !== repository ||
    !sha.test(manifest.sourceSha) ||
    !versionPattern.test(manifest.version) ||
    manifest.tag !==
      releaseTag(manifest.channel, manifest.version, manifest.sourceSha) ||
    !["linux/x86_64", "linux/aarch64", "macos/aarch64"].includes(
      `${manifest.platform}/${manifest.architecture}`,
    ) ||
    !/^\d+$/.test(manifest.producer.runId) ||
    !Number.isSafeInteger(manifest.producer.runAttempt) ||
    manifest.producer.runAttempt < 1 ||
    manifest.producer.workflow !== workflow ||
    !sha.test(manifest.producer.controlSha) ||
    !manifest.evidence.nativeChecks ||
    (manifest.platform === "macos" &&
      (!manifest.evidence.signing || !manifest.evidence.notarization))
  )
    throw Error("Invalid release manifest identity/evidence");
  const names = new Set<string>();
  for (const file of manifest.files) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.name) ||
      file.name.startsWith("manifest-") ||
      names.has(file.name) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1
    )
      throw Error("Invalid candidate file");
    names.add(file.name);
  }
  const base =
    manifest.platform === "linux"
      ? `Apparent-${manifest.version}-linux-${manifest.architecture}.AppImage`
      : `Apparent-Preview-${manifest.version}-arm64.dmg`;
  if (
    !names.has(base) ||
    !names.has(`${base}.sha256`) ||
    (manifest.platform === "macos" &&
      !names.has(`Apparent-Preview-${manifest.version}-arm64.zip`))
  )
    throw Error("Missing platform payload");
}
export async function verify(
  directory: string,
  manifest: Manifest,
): Promise<void> {
  identity(manifest);
  for (const file of manifest.files) {
    const path = join(directory, file.name);
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== file.size ||
      (await digest(path)) !== file.sha256
    )
      throw Error(`Candidate digest mismatch: ${file.name}`);
    if (file.name.endsWith(".sha256")) {
      const payload = manifest.files.find(
        (entry) => entry.name === file.name.slice(0, -7),
      );
      if (
        !payload ||
        readFileSync(path, "utf8").trim() !==
          `${payload.sha256}  ${payload.name}`
      )
        throw Error("Checksum sidecar mismatch");
    }
  }
}
export function paired(manifests: Manifest[]): Manifest {
  if (
    manifests.length !== 3 ||
    new Set(manifests.map((m) => `${m.platform}/${m.architecture}`)).size !== 3
  )
    throw Error("Both Linux architectures and Mac required before publication");
  const first = manifests[0];
  for (const m of manifests) {
    identity(m);
    if (
      m.sourceSha !== first.sourceSha ||
      m.version !== first.version ||
      m.tag !== first.tag ||
      m.channel !== first.channel ||
      JSON.stringify(m.producer) !== JSON.stringify(first.producer)
    )
      throw Error("Candidate identity differs across platforms");
  }
  return first;
}
export async function create(
  directory: string,
  platform: string,
  architecture: string,
  env = process.env,
): Promise<Manifest> {
  const files = [];
  for (const name of readdirSync(directory)
    .sort()
    .filter((name) => !name.startsWith("manifest-"))) {
    const stat = lstatSync(join(directory, name));
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error("Candidate assets must be regular files");
    files.push({
      name,
      size: stat.size,
      sha256: await digest(join(directory, name)),
    });
  }
  const manifest: Manifest = {
    schemaVersion: 1,
    repository: env.GITHUB_REPOSITORY!,
    sourceSha: env.CANDIDATE_SHA!,
    version: env.APPARENT_VERSION!,
    tag: env.RELEASE_TAG!,
    channel: (env.RELEASE_CHANNEL || "stable") as Manifest["channel"],
    platform,
    architecture,
    producer: {
      runId: env.GITHUB_RUN_ID!,
      runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
      workflow,
      controlSha: env.GITHUB_WORKFLOW_SHA!,
    },
    evidence: {
      nativeChecks: env.RELEASE_NATIVE_CHECKS === "true",
      signing: env.RELEASE_SIGNING === "true",
      notarization: env.RELEASE_NOTARIZATION === "true",
    },
    files,
  };
  await verify(directory, manifest);
  writeFileSync(
    join(directory, `manifest-${platform}-${architecture}.json`),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [command, directory, platform, architecture] = process.argv.slice(2);
  if (command !== "create" || !architecture)
    throw Error("Usage: manifest.ts create DIRECTORY PLATFORM ARCH");
  await create(directory, platform, architecture);
}
