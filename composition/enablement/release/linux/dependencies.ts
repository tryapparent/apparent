import { spawn } from "node:child_process";
import { once } from "node:events";

const archiveFailure =
  "E: Unable to fetch some archives, maybe run apt-get update or try with --fix-missing?";
const ubuntuPackage404 =
  /^E: Failed to fetch https?:\/\/(?:(?:(?:[a-z0-9-]+\.)*archive\.ubuntu\.com|security\.ubuntu\.com|mirrors\.edge\.kernel\.org)\/ubuntu|ports\.ubuntu\.com\/ubuntu-ports)\/pool\/(?:[a-zA-Z0-9+.-]+\/)+[a-z0-9+.-]+_[a-zA-Z0-9.+~%:-]+_[a-z0-9-]+\.deb +404 +Not Found(?: \[IP: [a-fA-F0-9:.]+ \d+\])?$/;

async function installDependencies(args: string[]): Promise<number> {
  const receiptLimit = 64 * 1024;
  const apt = async (parameters: string[], captureStderr = false) => {
    const child = spawn("sudo", ["env", "LC_ALL=C", "apt-get", ...parameters], {
      stdio: ["inherit", "inherit", captureStderr ? "pipe" : "inherit"],
    });
    let stderr = "";
    child.stderr?.pipe(process.stderr, { end: false });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length <= receiptLimit) stderr += chunk.toString();
    });
    const [status, signal] = (await once(child, "close")) as [
      number | null,
      NodeJS.Signals | null,
    ];
    if (signal) process.kill(process.pid, signal);
    return { status: status ?? 1, stderr };
  };

  const update = ["update", "--error-on=any"];
  const initial = await apt(update);
  if (initial.status !== 0) return initial.status;

  const install = await apt(args, true);
  if (install.status !== 100 || install.stderr.length > receiptLimit)
    return install.status;

  const errors = install.stderr.trimEnd().split("\n");
  if (
    errors.pop() !== archiveFailure ||
    !errors.length ||
    !errors.every((line) => ubuntuPackage404.test(line))
  ) {
    return install.status;
  }

  process.stderr.write(
    "Ubuntu package download returned HTTP 404. Refreshing APT indexes and retrying once.\n",
  );
  const refresh = await apt(update);
  return refresh.status === 0 ? (await apt(args)).status : refresh.status;
}

process.exitCode = await installDependencies(process.argv.slice(2));
