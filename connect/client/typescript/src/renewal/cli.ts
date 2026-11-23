import { createInterface } from "node:readline";
import { renewalTransition } from "./transition.ts";

for await (const input of createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})) {
  if (Buffer.byteLength(input) > 1024) process.exit(1);
  console.log(JSON.stringify(renewalTransition(input)));
}
