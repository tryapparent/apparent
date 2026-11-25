import { run } from "../../../../../shared/enablement/bend/toolchain.ts";

export function movieRouteTable(compiled: string): number[] {
  return JSON.parse(
    run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import policy from "./frame-limits.mjs";
    console.log(JSON.stringify(Array.from({length: 4}, (_, index) =>
      policy.use_movie_assembly(Boolean(index & 2), Boolean(index & 1)))));
  `,
      ],
      compiled,
    ),
  );
}
