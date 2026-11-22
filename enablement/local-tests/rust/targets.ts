export type Target = {
  manifest: string;
  package: string;
  args: string[];
  inputs: string[];
};

const targets: Target[] = [
  {
    manifest: "Cargo.toml",
    package: "apparent",
    args: ["--bin", "apparent"],
    inputs: [
      "enablement/build_version.rs",
      "enablement/native-build/",
      "record/shortcuts/",
      "record/enablement/shortcuts/",
      "engine/native/input/",
      "record/enablement/ci/bend/push-to-talk.ts",
      "record/enablement/ci/bend/modules.json",
      "shared/enablement/bend/",
      "record/enablement/permissions/native.ts",
      "record/capture-request/src/permission-requirements.ts",
      "onboarding/host/entry-policy.ts",
      "onboarding/enablement/ci/entry-policy.ts",
    ],
  },
  {
    manifest: "capture/engine/Cargo.toml",
    package: "apparent-capture-engine",
    args: ["--lib"],
    inputs: ["capture/engine/"],
  },
  {
    manifest: "connect/client/Cargo.toml",
    package: "apparent-connect-client",
    args: ["--lib"],
    inputs: ["connect/client/"],
  },
  {
    manifest: "engine/native/Cargo.toml",
    package: "apparent-engine-media",
    args: [
      "--bin",
      "apparent-engine-media",
      "--bin",
      "apparent-engine-frames",
      "--features",
      "frames",
      "--release",
    ],
    inputs: ["engine/native/"],
  },
  {
    manifest: "capture/agent/narrator/Cargo.toml",
    package: "apparent-narrator",
    args: ["--bin", "apparent-narrator", "--release"],
    inputs: ["capture/agent/narrator/"],
  },
];

const macDemo = "public/site/video-demo/";
const independent = ["engine/native/", "capture/agent/narrator/", macDemo];
const rustInput =
  /(?:\.rs$|(?:^|\/)(?:Cargo\.(?:toml|lock)|rust-toolchain(?:\.toml)?|\.cargo\/config(?:\.toml)?)$)/;

export function rustAffected(paths: string[]): boolean {
  return paths.some(
    (file) =>
      rustInput.test(file) ||
      targets.some((target) =>
        target.inputs.some((input) => !input.endsWith("/") && input === file),
      ),
  );
}

export function diagnosticsPlan(paths: string[]) {
  const global = paths.some(
    (file) =>
      file.startsWith(".cargo/") || /^rust-toolchain(?:\.toml)?$/.test(file),
  );
  const selected = targets.filter(
    (target, index) =>
      global ||
      paths.some((file) => {
        const matchesInput = target.inputs.some((input) =>
          input.endsWith("/") ? file.startsWith(input) : input === file,
        );
        if (index === 0)
          return (
            matchesInput ||
            (rustInput.test(file) &&
              independent.every((dir) => !file.startsWith(dir)))
          );
        return rustInput.test(file) && matchesInput;
      }),
  );
  return {
    selected,
    demo: paths.some(
      (file) => file.startsWith(macDemo) && rustInput.test(file),
    ),
  };
}
