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
    "record/storage/src/retention/capacity.bend",
  );
  process.stdout.write(
    run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
        import capacity from './capacity.mjs';
        const defaults = [false, true].map(hasRetention => {
          const limit = capacity.default_limit_mb(hasRetention);
          return limit === 0 ? 'None' : 'Some(' + limit + ')';
        });
        console.log('const DEFAULT_STORAGE_LIMIT_MB: [Option<u32>; 2] = [' + defaults.join(', ') + '];');
        `,
      ],
      scratch,
    ),
  );
});
