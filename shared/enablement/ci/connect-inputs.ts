import { execFileSync } from "node:child_process";

export const serviceOnlyInputs = new Set([
  "connect/service/src/reporting/aggregate-dau.ts",
  "connect/service/test/lifecycle/aggregate-dau.test.ts",
]);

export function serviceOnlyRange(
  base: string,
  head: string,
  paths: string[],
  cwd: string,
): boolean {
  if (!paths.some((path) => serviceOnlyInputs.has(path))) return true;
  return [base, head].every((ref) => {
    try {
      execFileSync(
        "git",
        [
          "grep",
          "-q",
          "-I",
          "-E",
          "aggregate-dau|admitDailyActivity|queueDailyActivity|cleanupDailyActivity",
          ref,
          "--",
          ":!connect/service/**",
          ":!connect/enablement/ci/**",
          ":!enablement/ci/**",
          ":!shared/enablement/ci/connect-inputs.ts",
          ":!.github/workflows/checks.yml",
          ":!*.md",
        ],
        { cwd, stdio: "ignore" },
      );
      return false;
    } catch (error) {
      return (error as { status?: number }).status === 1;
    }
  });
}

export const portableForegroundInputs = new Set([
  "connect/client/typescript/src/foreground.ts",
  "connect/client/typescript/test/foreground.test.ts",
]);
export function foregroundPortableChange(
  path: string,
  before: string,
  after: string,
): boolean {
  const source = path.endsWith("/src/foreground.ts");
  const allowed = source
    ? ["node:readline", "node:url"]
    : ["node:assert/strict", "node:test", "../src/foreground.ts"];
  const closure = (text: string) => {
    const imports: string[] = [];
    const rest = text.replace(
      /^\s*import\s+.*?from\s*['"]([^'"]+)['"];?/gm,
      (_line, name: string) => {
        imports.push(name);
        return "";
      },
    );
    return (
      !/\b(?:import|require)\b/.test(rest.replace(/\bimport\.meta\b/g, "")) &&
      imports.length === allowed.length &&
      imports.every((name) => allowed.includes(name)) &&
      new Set(imports).size === allowed.length
    );
  };
  if (!closure(before) || !closure(after)) return false;
  const resources =
    /\bprocess\s*[.\[]|\bglobalThis\b|\b(?:fetch|WebSocket|XMLHttpRequest|eval|Function)\s*\(/;
  if (!source) return !resources.test(before) && !resources.test(after);
  const protocol = (text: string) => {
    const types = text.match(/export type Asset[\s\S]*?(?=\nconst fail)/)?.[0];
    const signature = text.match(
      /export async function uploadForeground[^\n]*/,
    )?.[0];
    const stdio = text.match(/async function stdio\(\)[\s\S]*/)?.[0];
    if (
      !types ||
      !signature ||
      !stdio ||
      /\bas\s+any\b/.test(text) ||
      resources.test(text.replace(stdio, ""))
    )
      return null;
    const channels = text.match(/\b\w+\.(?:request|progress)\s*\(/g) ?? [];
    const packets = [
      ...text.matchAll(/\b\w+\.(request|progress)\s*\(\s*\{([^{}]*)\}\s*\)/g),
    ].map((match) => [match[1], match[2]]);
    if (channels.length !== packets.length || /\bport\s*\[/.test(text))
      return null;
    const casts = [...text.matchAll(/\bas\s+(\w+)/g)]
      .map((match) => match[1])
      .sort();
    const operations = [...text.matchAll(/operation:\s*['"]([^'"]+)['"]/g)]
      .map((match) => match[1])
      .sort();
    return JSON.stringify({
      types,
      signature,
      stdio,
      operations,
      packets,
      casts,
    });
  };
  const original = protocol(before);
  return original !== null && original === protocol(after);
}
