export const publicMarkdown = new Set([
  "README.md",
  "capture/agent/docs/usage.md",
  "capture/desktop/docs/guides/recording.md",
  "capture/engine/docs/guides/processing.md",
]);
export const hostedBrowserFixture =
  "public/enablement/browser-proof/test-hosted-browser.mjs";
export const verification = {
  cwd: "public/site",
  argv: ["node", "../enablement/site-build/verify.mjs"],
};

export const apparentSkill = "agent/skills/apparent/";
const proseRoots = [
  "capture",
  "record",
  "agent",
  "connect",
  "public",
  "hermes",
  "enablement",
  "shared",
  "composition",
  "engine",
  "handoff",
  "onboarding",
];
const rootProse = new Set([
  "CONTRIBUTING.md",
  "LICENSE",
  "NOTICE",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "CONTEXT.md",
  "VERIFICATION.md",
]);
const productMarkdown = new Set([
  "hermes/README.md",
  "connect/client/typescript/README.md",
]);
const embeddedSegments =
  /(^|\/)(skills?|prompts?|instructions?|tests?|fixtures?|templates?)(\/|$)/i;
export function documentationOnlyPath(path: string) {
  if (
    rootProse.has(path) ||
    /^agent\/skills\/(?:\.gitattributes|(?:pitch-deck|make-it-apparent)\/.*\.md)$/.test(
      path,
    )
  )
    return true;
  if (
    !path.endsWith(".md") ||
    publicMarkdown.has(path) ||
    path.startsWith(apparentSkill) ||
    productMarkdown.has(path)
  )
    return false;
  if (
    /^public\/site\/(public|src|brand\/(src|shared))\//.test(path) ||
    (embeddedSegments.test(path) && !/(^|\/)README\.md$/i.test(path))
  )
    return false;
  if (/(^|\/)AGENTS\.md$/.test(path)) return true;
  if (/(^|\/)(AGENTS|SKILL|CLAUDE|GEMINI)[^/]*\.md$/i.test(path)) return false;
  return proseRoots.includes(path.split("/")[0]);
}
