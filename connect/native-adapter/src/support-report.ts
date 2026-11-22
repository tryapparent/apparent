import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export function supportTransport(executable: string | undefined) {
  const availableExecutable = executable && isAbsolute(executable) ? executable : undefined;
  return {
    async available() {
      if (!availableExecutable) return false;
      try {
        await run(availableExecutable, ["connect", "support-report-available"], { timeout: 12000, maxBuffer: 8192 });
        return true;
      } catch {
        return false;
      }
    },
    async submit(bundle: string, archive: string, id: string) {
      if (!availableExecutable) throw Error("Support reporting unavailable");
      await run(availableExecutable, ["connect", "submit-support-report", bundle, archive, id],
        { timeout: 600000, maxBuffer: 8192 });
    },
  };
}
