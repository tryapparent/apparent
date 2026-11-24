import { createRequire } from "node:module";
import { receiver } from "../../../../handoff/enablement/performance/receiver.ts";

const require = createRequire(
  new URL(
    "../../../../capture/desktop/ui/frontend/package.json",
    import.meta.url,
  ),
);
const { wsServer } = require("playwright-core/lib/utilsBundle");

export function fixture(lifecycle: Parameters<typeof receiver>[0]) {
  return receiver(lifecycle, wsServer);
}
