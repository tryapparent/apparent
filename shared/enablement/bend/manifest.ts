export const bendOwners = [
  "agent",
  "composition",
  "connect",
  "enablement",
  "engine",
  "handoff",
  "hermes",
  "onboarding",
  "public",
  "record",
  "shared",
] as const;

export type BendOwner = (typeof bendOwners)[number];

export function bendDirectory(owner: BendOwner): string {
  return owner === "enablement"
    ? "enablement/ci/bend"
    : `${owner}/enablement/ci/bend`;
}

export const sharedBendInput = (path: string) =>
  path.startsWith("shared/enablement/bend/");

const moduleName = /^(?:[\w-]+\/)*[\w-]+\.bend$/;
const inputName = /^(?:[\w.-]+\/)*[\w.-]+\/?$/;
const reserved = new Set(["dist", "node_modules", "target", ".", ".."]);

export function parseManifest(owner: BendOwner, json: string) {
  const path = `${bendDirectory(owner)}/modules.json`;
  const manifest: { modules?: unknown; inputs?: unknown } = JSON.parse(json);
  const { modules, inputs } = manifest;
  if (
    Object.keys(manifest).some(
      (key) => key !== "modules" && key !== "inputs",
    ) ||
    !Array.isArray(modules) ||
    !Array.isArray(inputs)
  )
    throw new Error(`${path}: expected modules and inputs arrays`);
  const outputs = new Set<string>();
  for (const source of modules) {
    if (
      typeof source !== "string" ||
      !moduleName.test(source) ||
      source.split("/").some((part) => reserved.has(part))
    )
      throw new Error(`${path}: invalid Bend source path ${source}`);
    const output = source
      .split("/")
      .at(-1)!
      .replace(/\.bend$/, ".mjs");
    if (outputs.has(output))
      throw new Error(`${path}: duplicate output ${output}`);
    outputs.add(output);
  }
  for (const input of inputs)
    if (
      typeof input !== "string" ||
      !inputName.test(input) ||
      input.split("/").some((part) => reserved.has(part))
    )
      throw new Error(`${path}: invalid owner input ${input}`);
  return {
    modules: (modules as string[]).map((source) => `${owner}/${source}`),
    inputs: (inputs as string[]).map((input) => `${owner}/${input}`),
  };
}
