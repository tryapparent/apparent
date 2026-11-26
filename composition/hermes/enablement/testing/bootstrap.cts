import { app } from "electron";
import { createRequire } from "node:module";
import path from "node:path";
// Isolate Electron's OS-resolved app data as well as HOME before loading the
// unchanged shipped main process, including its persistent replay guard.
const directory = process.env.APPARENT_SYNTHETIC_APP_DATA;
const main = process.argv[2];
if (!directory || !path.isAbsolute(directory) || !path.isAbsolute(main))
  throw new Error("Private smoke paths required");
app.setPath("appData", directory);
const load = createRequire(__filename);
load(main);
