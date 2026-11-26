import { app } from "electron";
import path from "node:path";
import { homedir } from "node:os";
import { OnboardingConnectAdapter } from "@apparent/connect-native-adapter/onboarding";
import {
  macWispr,
  savedWisprExperiment,
} from "@apparent/onboarding/wispr-native";
import { install } from "./reporting.ts";
import { reportException } from "./exception.ts";
import { start } from "./host.ts";
import frogPolicy from "@apparent/onboarding/desktop-frog";
import { startDesktopFrog } from "../../../onboarding/electron/desktop-frog/host.ts";
import { frogPlatform } from "../frog/platform.ts";

const index = process.argv.indexOf("--assets-root");
if (
  index < 0 ||
  !process.argv[index + 1] ||
  !path.isAbsolute(process.argv[index + 1])
)
  throw Error("Missing native onboarding assets root");
const home = homedir();
install(app, (kind) => reportException(home, kind));
if (process.argv.includes("--desktop-frog"))
  startDesktopFrog(process.argv[index + 1], frogPlatform, frogPolicy);
else
  start({
    assets: process.argv[index + 1],
    connect: new OnboardingConnectAdapter(home),
    wispr: macWispr,
    wisprEnabled: () => savedWisprExperiment(home),
  });
