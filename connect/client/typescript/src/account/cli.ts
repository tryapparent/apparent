import { accountPresentation, decodeFacts } from "./presentation.ts";

let input = "";
for await (const chunk of process.stdin.setEncoding("utf8")) {
  input += chunk;
  if (Buffer.byteLength(input) > 16_384) process.exit(1);
}
try {
  const facts = decodeFacts(JSON.parse(input));
  if (!facts) process.exit(1);
  console.log(JSON.stringify(accountPresentation(facts)));
} catch {
  process.exitCode = 1;
}
