import path from "node:path";
import { getEncoding } from "js-tiktoken";

const encoding = getEncoding("o200k_base");
export const tokens = (text: string) => encoding.encode(text, [], []).length;
export const lockfiles = new Set([
  "Cargo.lock",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "bun.lock",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
  "uv.lock",
  "poetry.lock",
]);
export function sourceBudget(
  file: string,
  text: string,
  old?: string,
): string[] {
  if (lockfiles.has(path.posix.basename(file))) return [];
  if (
    file
      .split("/")
      .some((part) =>
        [
          "node_modules",
          "vendor",
          "third_party",
          "third-party",
          "target",
          ".git",
          "__pycache__",
        ].includes(part),
      )
  )
    return [];
  if (
    [
      "public/site/published-homepage/",
      "public/site/video-demo/output/",
      "connect/web/dist/",
      "connect/web/dist-site-check/",
    ].some((prefix) => file.startsWith(prefix))
  )
    return [];
  if (
    !/\.(?:[cm]?[jt]sx?|bend|rs|py|swift|sh|bash|zsh|css|html?|c|h|cc|cpp|cxx|hpp|hh|m|mm|metal|lock|lockb)$/i.test(
      file,
    ) &&
    !text.startsWith("#!")
  )
    return [];
  const count = tokens(text);
  const allowance = Math.max(4000, old === undefined ? 0 : tokens(old));
  return count > allowance
    ? [
        `${file}: ${count} source tokens exceed cap/inherited allowance (${allowance})`,
      ]
    : [];
}
