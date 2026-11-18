import { execFileSync, spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const runnerPaths = {
  mirrors: "/etc/apt/apt-mirrors.txt",
  transport: "/etc/apt/apt.conf.d/zzzz-apparent-transport",
  osRelease: "/etc/os-release",
  aptHelper: "/usr/lib/apt/apt-helper",
  temporaryRoot: "/tmp",
};

const limits = [
  ["apparentRetries", "Acquire::Retries", "1"],
  ["apparentHttp", "Acquire::http::Timeout", "15"],
  ["apparentHttps", "Acquire::https::Timeout", "15"],
];

const candidates = [
  "https://archive.ubuntu.com/ubuntu",
  "https://mirrors.edge.kernel.org/ubuntu",
];
const priorityEntry = (url: string) => url + "/\tpriority:0";

const probeScript = `set -euo pipefail
helper=$1
base=$2
suite=$3
work=$4
"$helper" -o Acquire::Retries=0 \\
  -o Acquire::http::Timeout=5 -o Acquire::https::Timeout=5 \\
  download-file "$base/dists/$suite/InRelease" "$work/InRelease"
digest=$(awk '$3 == "main/binary-amd64/Packages.xz" && length($1) == 64 {print $1}' "$work/InRelease")
[[ "$digest" =~ ^[0-9a-f]{64}$ ]]
"$helper" -o Acquire::Retries=0 \\
  -o Acquire::http::Timeout=5 -o Acquire::https::Timeout=5 \\
  download-file "$base/dists/$suite/main/binary-amd64/by-hash/SHA256/$digest" \\
  "$work/Packages.xz" "SHA256:$digest"
`;

export function prepareHostedUbuntuApt(paths = runnerPaths, env = process.env) {
  if (
    env.RUNNER_OS !== "Linux" ||
    env.GITHUB_ACTIONS !== "true" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.RUNNER_ARCH !== "X64"
  ) {
    throw new Error(
      "APT preparation requires an x64 GitHub-hosted Linux runner",
    );
  }

  const existingTransport = lstatSync(paths.transport, {
    throwIfNoEntry: false,
  });
  if (
    !lstatSync(paths.mirrors).isFile() ||
    (existingTransport && !existingTransport.isFile())
  ) {
    throw new Error(
      "APT preparation requires regular mirror list and transport files",
    );
  }
  const osRelease = readFileSync(paths.osRelease, "utf8");
  const codename = osRelease.match(/^VERSION_CODENAME="?([a-z0-9]+)"?$/m)?.[1];
  if (!/^ID=(?:ubuntu|"ubuntu"|'ubuntu')$/m.test(osRelease) || !codename) {
    throw new Error("APT preparation requires an Ubuntu release codename");
  }

  const job = mkdtempSync(join(paths.temporaryRoot, "apparent-dev-apt-"));
  const install = (source: string, target: string) =>
    execFileSync(
      "sudo",
      ["install", "-o", "root", "-g", "root", "-m", "0644", source, target],
      {
        env,
        stdio: "inherit",
      },
    );
  try {
    const transport = join(job, "transport");
    writeFileSync(
      transport,
      limits.map(([, key, value]) => `${key} "${value}";\n`).join(""),
    );
    install(transport, paths.transport);
    const effective = execFileSync(
      "sudo",
      ["apt-config", "shell", ...limits.flatMap(([name, key]) => [name, key])],
      { env, encoding: "utf8" },
    );
    const expected = limits
      .map(([name, , value]) => `${name}='${value}'\n`)
      .join("");
    if (effective !== expected) {
      throw new Error(
        "Effective APT acquisition limits differ from required retries=1 / inactivity=15s",
      );
    }
    process.stdout.write(effective);

    const probe = join(job, "probe.sh");
    writeFileSync(probe, probeScript);
    for (const [index, candidate] of candidates.entries()) {
      const work = join(job, "probe-" + index);
      mkdirSync(work);
      const result = spawnSync(
        "sudo",
        [
          "timeout",
          "--signal=TERM",
          "--kill-after=2s",
          "10s",
          "bash",
          probe,
          paths.aptHelper,
          candidate,
          codename + "-updates",
          work,
        ],
        { env, stdio: "inherit" },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) continue;

      const original =
        readFileSync(paths.mirrors, "utf8").match(/[^\n]*\n|[^\n]+$/g) ?? [];
      const retained = original.filter(
        (line) =>
          !candidates.some(
            (url) => line.replace(/\n$/, "") === priorityEntry(url),
          ),
      );
      const mirrors = join(job, "mirrors");
      writeFileSync(
        mirrors,
        priorityEntry(candidate) +
          "\n" +
          retained.join("").replace(/([^\n])$/, "$1\n"),
      );
      install(mirrors, paths.mirrors);
      console.log("APT mirror selected: " + candidate);
      return;
    }
    console.log(
      "::warning::Neither preferred Ubuntu mirror passed the APT probe. Continuing with the runner mirror list.",
    );
  } finally {
    rmSync(job, { recursive: true, force: true });
  }
}

if (import.meta.main) prepareHostedUbuntuApt();
