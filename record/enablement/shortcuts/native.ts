import { recordDefault, usesDesktopRecord } from "../../shortcuts/policy.ts";

const platform = process.argv[2] === "macos" ? "macos" : "linux";
const binding = recordDefault(platform);
const desktop = [false, true].flatMap((appPreferred) =>
  [false, true].map((available) =>
    usesDesktopRecord(platform, appPreferred, available),
  ),
);

process.stdout.write(
  [
    `const RECORD_DEFAULT_KEY: &str = ${JSON.stringify(binding.key)};`,
    `const RECORD_DEFAULT_CODE: Option<u32> = ${binding.keyCode === null ? "None" : `Some(${binding.keyCode})`};`,
    `const RECORD_DEFAULT_MODIFIERS: u32 = ${binding.modifiers};`,
    `const DESKTOP_RECORD_PRECEDENCE: [bool; 4] = [${desktop.join(", ")}];`,
  ].join("\n"),
);
