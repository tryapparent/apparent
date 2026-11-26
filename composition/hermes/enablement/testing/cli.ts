#!/usr/bin/env -S node --experimental-strip-types
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
} from "node:fs";
const args = process.argv.slice(2);
const file = process.env.APPARENT_SYNTHETIC_RECEIPT!;
const trace = process.env.APPARENT_SYNTHETIC_TRACE!;
appendFileSync(trace, JSON.stringify(args) + "\n");
let receipt: {
  capture_id: string;
  status: string;
  source?: string;
  bundle_path?: string;
  remote_source?: string | null;
};
if (args[0] === "launch") {
  writeFileSync(file + ".launched", String(Date.now()));
  process.exit(0);
}
if (args[1] === "state") {
  const gate = process.env.APPARENT_SYNTHETIC_PROBE_GATE;
  if (gate) {
    const deadline = Date.now() + 4000;
    while (!existsSync(gate) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    if (!existsSync(gate)) process.exit(1);
  }
  if (
    process.env.APPARENT_SYNTHETIC_NEEDS_LAUNCH === "1" &&
    !existsSync(file + ".launched")
  )
    process.exit(1);
  const delay = Number(process.env.APPARENT_SYNTHETIC_STARTUP_DELAY_MS ?? "0");
  if (
    delay > 0 &&
    Date.now() < Number(readFileSync(file + ".launched", "utf8")) + delay
  )
    process.exit(1);
  console.log(
    JSON.stringify({
      state: { phase: existsSync(file + ".occupied") ? "recording" : "idle" },
    }),
  );
  process.exit(0);
}
if (args[1] === "start") {
  receipt = {
    capture_id: args[args.indexOf("--request-id") + 1],
    status: "recording",
  };
  if (process.env.APPARENT_SYNTHETIC_NATIVE_OCCUPIED === "1") {
    console.log(
      JSON.stringify({ ...receipt, status: "rejected", error: "occupied" }),
    );
    process.exit(1);
  }
  writeFileSync(file, JSON.stringify(receipt));
} else {
  receipt = JSON.parse(readFileSync(file, "utf8"));
  if (args[1] === "inspect" && existsSync(file + ".finished"))
    receipt.status = "saved";
  if (args[1] === "handoff") {
    receipt.bundle_path = "/synthetic/owned.apparent";
    receipt.remote_source = null;
    receipt.source = receipt.bundle_path;
  }
}
console.log(JSON.stringify(receipt));
