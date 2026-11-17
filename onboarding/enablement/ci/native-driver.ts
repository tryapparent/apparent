import { PracticeHost } from "../../practice/host.ts";
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 16777216) throw Error("Oversized native practice history");
}
const batches: unknown = JSON.parse(input);
if (!Array.isArray(batches) || !batches.length)
  throw Error("Missing native batches");
const host = new PracticeHost();
let reply: ReturnType<PracticeHost["accept"]> | undefined;
for (const batch of batches) reply = host.accept(batch);
process.stdout.write(JSON.stringify(reply));
