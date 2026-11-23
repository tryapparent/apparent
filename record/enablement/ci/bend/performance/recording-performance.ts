import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../../../shared/enablement/bend/build.ts";
import { run } from "../../../../../shared/enablement/bend/toolchain.ts";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
await bendScratch(async (scratch) => {
  await buildBend(
    root,
    "record",
    scratch,
    undefined,
    "record/settings/permissions/performance-policy.bend",
  );
  const [percent, short, medium] = JSON.parse(
    run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import policy from "./performance-policy.mjs";
      console.log(JSON.stringify([policy.sample_percent(), policy.short_recording_ms(), policy.medium_recording_ms()]));
    `,
      ],
      scratch,
    ),
  );
  console.log(`const SAMPLE_PERCENT: u16 = ${percent};
const SHORT_RECORDING_MS: u64 = ${short};
const MEDIUM_RECORDING_MS: u64 = ${medium};`);
});
