import { fstatSync, readFileSync } from "node:fs";
import { sceneRequest } from "./scene-request.ts";
const LIMIT = 16 * 1024 * 1024;
try {
  const input = fstatSync(0);
  if (
    process.argv.length !== 2 ||
    !input.isFile() ||
    input.size > LIMIT ||
    (input.mode & 0o777) !== 0o600
  )
    throw Error("Invalid input");
  const bytes = readFileSync(0);
  if (bytes.length > LIMIT) throw Error("Invalid input");
  const output = sceneRequest(bytes.toString("utf8")) + "\n";
  if (Buffer.byteLength(output) > LIMIT) throw Error("Invalid output");
  process.stdout.write(output);
} catch {
  process.stderr.write("Record could not classify scene transitions\n");
  process.exitCode = 1;
}
