import { builtinModules } from "node:module";

export type Edge = { from: string; target?: string; spec: string };
const pure = new Set([
  "capture/desktop/ui/frontend/electron/onboarding/presentation.ts",
  "capture/desktop/ui/frontend/electron/onboarding/selection.ts",
  "capture/desktop/ui/frontend/src/onboarding/state.ts",
  "capture/desktop/ui/frontend/src/onboarding/shortcut/keys.ts",
]);
export function context(file: string): string | undefined {
  if (
    pure.has(file) ||
    file === "record/completion/src/policy.ts" ||
    /^(onboarding|record|handoff|connect|agent|public|hermes|shared)\/(?:.*\/)?pure\//.test(
      file,
    )
  )
    return "pure";
  if (
    file.startsWith("capture/desktop/ui/frontend/src/") ||
    /^(onboarding|record|handoff|connect|agent|public|hermes|shared|composition)\/(?:.*\/)?renderer\//.test(
      file,
    ) ||
    file.startsWith("shared/ui/src/") ||
    file.startsWith("connect/web/src/")
  )
    return "renderer";
  if (
    file.startsWith("capture/desktop/ui/frontend/electron/") ||
    /\/(main|preload|native)\//.test(file) ||
    file.endsWith(".node")
  )
    return "privileged";
}
export function executionEdges(edges: Edge[]): Set<string> {
  const result = new Set<string>();
  const graph = new Map<string, Edge[]>();
  for (const edge of edges)
    graph.set(edge.from, [...(graph.get(edge.from) ?? []), edge]);
  for (const origin of graph.keys()) {
    const kind = context(origin);
    if (kind !== "pure" && kind !== "renderer") continue;
    const seen = new Set<string>();
    function walk(file: string) {
      if (seen.has(file)) return;
      seen.add(file);
      for (const edge of graph.get(file) ?? []) {
        const privileged =
          edge.spec === "electron" ||
          edge.spec.startsWith("node:") ||
          builtinModules.includes(edge.spec) ||
          context(edge.target ?? "") === "privileged";
        const dom =
          kind === "pure" &&
          (edge.spec.startsWith("dom:global/") ||
            /^(react|react-dom)(\/|$)/.test(edge.spec) ||
            context(edge.target ?? "") === "renderer");
        if (privileged || dom)
          result.add(
            `${origin}: ${kind} reaches ${file} -> ${edge.target ?? edge.spec}`,
          );
        if (edge.target) walk(edge.target);
      }
    }
    walk(origin);
  }
  return result;
}
