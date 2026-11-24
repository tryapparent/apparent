import { run } from "../../../../shared/enablement/bend/toolchain.ts";

export const actionContextTable = (compiled: string) =>
  run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import policy from "./action-context.mjs";
      const table = Array.from({ length: 8 }, (_, bits) =>
        policy.admit_action_context(...[1, 2, 4].map(flag => Boolean(bits & flag))));
      console.log(JSON.stringify(table));
      `,
    ],
    compiled,
  ).trim();
