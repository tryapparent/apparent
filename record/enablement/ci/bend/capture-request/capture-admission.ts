import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../../../shared/enablement/bend/build.ts";
import { run } from "../../../../../shared/enablement/bend/toolchain.ts";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));

export function captureAdmission(directory: string): {
  start: string[];
  control: string[];
  endedReceipts: string[];
} {
  return JSON.parse(
    run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import policy from "./capture-admission.mjs";
    const table = (bits, decide) => Array.from({ length: 2 ** bits }, (_, index) =>
      decide(...Array.from({ length: bits }, (_, bit) => Boolean(index & (1 << bit)))).$);
    const receipts = {
      unknown: "Unknown", starting: "Starting", recording: "Recording", rejected: "Rejected",
      processing: "Processing", saved: "Saved", cancelled: "CancelledReceipt", failed: "Failed",
    };
    console.log(JSON.stringify({
      start: table(3, policy.admit_start),
      control: table(7, policy.admit_control),
      endedReceipts: Object.keys(receipts).filter(status => policy.ended_for_stop({ $: receipts[status] })),
    }));
  `,
      ],
      directory,
    ),
  );
}

function rustArray(
  values: string[],
  length: number,
  type: string,
  variants: string[],
): string {
  assert.equal(values.length, length);
  return values
    .map((value) => {
      assert.ok(variants.includes(value));
      return `${type}::${value}`;
    })
    .join(", ");
}

export function buildCaptureAdmission() {
  return bendScratch(async (scratch) => {
    await buildBend(
      root,
      "record",
      scratch,
      undefined,
      "record/capture-request/",
    );
    return captureAdmission(scratch);
  });
}

if (import.meta.main) {
  const { start, control, endedReceipts } = await buildCaptureAdmission();
  const starts = rustArray(start, 8, "StartDecision", [
    "Existing",
    "Expired",
    "Occupied",
    "Begin",
  ]);
  const outcomes = rustArray(control, 128, "Outcome", [
    "DeadlinePassed",
    "AlreadyEnded",
    "WrongCapture",
    "NotReady",
    "Stopping",
    "Cancelled",
  ]);
  process.stdout.write(`const START: [StartDecision; 8] = [${starts}];
const CONTROL: [Outcome; 128] = [${outcomes}];
const ENDED_RECEIPTS: &[&str] = &${JSON.stringify(endedReceipts)};
`);
}
