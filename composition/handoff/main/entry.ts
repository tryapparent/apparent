import { homedir } from "node:os";
import { join } from "node:path";
import { Controller } from "../../../handoff/main/controller.ts";

export function createController(changed: () => void) {
  const configFile =
    process.env.APPARENT_CONFIG ??
    join(homedir(), ".config/apparent/config.json");
  return new Controller(changed, configFile);
}
