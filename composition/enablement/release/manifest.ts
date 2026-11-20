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

export type Channel = "main" | "mac-main" | "stable";
export type Manifest = {
  schemaVersion: 1;
  repository: string;
  sourceSha: string;
  version: string;
  tag: string;
  channel: Channel;
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
  if (channel === "mac-main") return `mac-main-v2-${source}`;
  throw Error("Unsupported release channel");
}
export const linuxTargets = [
  { platform: "linux", architecture: "x86_64", job: "linux / Linux x86_64" },
  { platform: "linux", architecture: "aarch64", job: "linux / Linux aarch64" },
] as const;
export const macPrimaryJob = "macos / Build signed Mac candidate";
export const macFallbackJob = "macos / Build signed Mac candidate fallback";
const macTarget = {
  platform: "macos",
  architecture: "aarch64",
  job: macPrimaryJob,
} as const;

export function targets(channel: Channel, pairedMain = false) {
  if (channel === "stable" || (channel === "main" && pairedMain))
    return [...linuxTargets, macTarget];
  return channel === "main" ? linuxTargets : [macTarget];
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
  const macAsset =
    manifest.channel === "main" && names.has("mac-update.json")
      ? "Apparent-Nightly"
      : "Apparent-Preview";
  const base =
    manifest.platform === "linux"
      ? `Apparent-${manifest.version}-linux-${manifest.architecture}.AppImage`
      : `${macAsset}-${manifest.version}-arm64.dmg`;
  if (
    !names.has(base) ||
    !names.has(`${base}.sha256`) ||
    (manifest.platform === "macos" &&
      !names.has(`${macAsset}-${manifest.version}-arm64.zip`))
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
export function candidateIdentity(
  manifests: Manifest[],
  channel: Channel,
  pairedMain = false,
): Manifest {
  const expected = targets(channel, pairedMain);
  if (
    manifests.length !== expected.length ||
    !expected.every(({ platform, architecture }) =>
      manifests.some(
        (m) => m.platform === platform && m.architecture === architecture,
      ),
    )
  )
    throw Error(
      "Release candidate is missing one or more required platform artifacts",
    );
  const first = manifests[0];
  for (const m of manifests) {
    identity(m);
    if (
      m.sourceSha !== first.sourceSha ||
      m.version !== first.version ||
      m.tag !== first.tag ||
      m.channel !== channel ||
      JSON.stringify(m.producer) !== JSON.stringify(first.producer)
    )
      throw Error("Candidate identity differs across platforms");
  }
  return first;
}
export function paired(manifests: Manifest[]): Manifest {
  return candidateIdentity(manifests, "stable");
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
