import { fileURLToPath } from "node:url";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export function markElectronAccessory(runtime: string) {
  execFileSync("/usr/bin/plutil", [
    "-replace",
    "LSUIElement",
    "-bool",
    "YES",
    join(runtime, "Contents/Info.plist"),
  ]);
}

export const appDisplayNames = '"CFBundleName" = "apparent";\n"CFBundleDisplayName" = "apparent";\n';

export function appPlist(version: string, build: string, key: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>Apparent launch</string><key>CFBundleURLSchemes</key><array><string>apparent</string></array><key>CFBundleTypeRole</key><string>Viewer</string></dict></array>
<key>CFBundleExecutable</key><string>apparent</string>
<key>CFBundleIconFile</key><string>Apparent</string>
<key>CFBundleIdentifier</key><string>dev.simonvanlaak.apparent.preview</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>CFBundleName</key><string>Apparent Preview</string>
<key>CFBundleDisplayName</key><string>Apparent Preview</string>
<key>CFBundleDevelopmentRegion</key><string>en</string>
<key>LSHasLocalizedDisplayName</key><true/>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${build}</string>
<key>LSMinimumSystemVersion</key><string>15.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>NSScreenCaptureUsageDescription</key><string>Apparent captures your screen to build annotated agent bundles.</string>
<key>NSMicrophoneUsageDescription</key><string>Apparent records your voice to align transcripts with keyframes.</string>
<key>NSCameraUsageDescription</key><string>Apparent mirrors and records a cabled iPhone's screen.</string>
<key>NSSpeechRecognitionUsageDescription</key><string>Apparent transcribes your narration on this Mac.</string>
<key>NSAppleEventsUsageDescription</key><string>Apparent reads the address of the browser tab you captured to record its context.</string>
<key>SUEnableAutomaticChecks</key><true/>
<key>SUAutomaticallyUpdate</key><false/>
<key>SUAllowsAutomaticUpdates</key><false/>
<key>SUFeedURL</key><string>https://raw.githubusercontent.com/tryapparent/apparent/preview-mac-feed/appcast.xml</string>
<key>SUPublicEDKey</key><string>${key}</string>
<key>SUVerifyUpdateBeforeExtraction</key><true/>
</dict></plist>`;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "key") {
    if (
      !/^[A-Za-z0-9+/]{43}=$/.test(args[0]) ||
      Buffer.from(args[0], "base64").length !== 32
    )
      throw Error("Invalid Sparkle public key");
  } else if (command === "electron-accessory" && args.length === 1) {
    markElectronAccessory(args[0]);
  } else if (command === "installer") {
    const [app, version, build, id] = args;
    const plist = {
      CFBundleIdentifier: id,
      CFBundleName: "Install apparent",
      CFBundleDisplayName: "Install apparent",
      CFBundleExecutable: "Installer",
      CFBundlePackageType: "APPL",
      CFBundleIconFile: "frog",
      CFBundleShortVersionString: version,
      CFBundleVersion: build,
      LSMinimumSystemVersion: "15.0",
      NSHighResolutionCapable: true,
    };
    const file = join(app, "Contents/Info.plist");
    const escape = (value: string) =>
      value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    writeFileSync(
      file,
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>' +
        Object.entries(plist)
          .map(
            ([key, value]) =>
              "<key>" +
              key +
              "</key>" +
              (typeof value === "boolean"
                ? "<true/>"
                : "<string>" + escape(value) + "</string>"),
          )
          .join("") +
        "</dict></plist>",
    );
    writeFileSync(
      join(app, "Contents/Resources/installer-ui/package.json"),
      JSON.stringify({
        name: "apparent-installer",
        version: "0.0.0",
        main: "electron/installer/main.cjs",
      }),
    );
  } else if (command === "notes") {
    const [prepared, destination] = args;
    mkdirSync(join(destination, "electron"), { recursive: true });
    for (const name of ["runtime.cjs", "notes", "share"]) {
      if (name === "share" && !existsSync(join(prepared, "app/electron", name)))
        continue;
      cpSync(
        join(prepared, "app/electron", name),
        join(destination, "electron", name),
        { recursive: true },
      );
    }
    cpSync(join(prepared, "app/dist"), join(destination, "dist"), {
      recursive: true,
    });
  } else throw Error("Unknown Mac metadata command");
}
