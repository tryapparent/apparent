import path from "node:path";

export type Warning = { key: string; location: string; message: string };

type Span = {
  is_primary: boolean;
  file_name: string;
  line_start: number;
  text: { text: string }[];
};

type CargoEvent = {
  reason: string;
  success?: boolean;
  manifest_path?: string;
  target?: { name: string; kind: string[] };
  message?: {
    level: string;
    code: { code: string } | null;
    message: string;
    rendered: string | null;
    spans: Span[];
  };
};

export function compilerMessages(
  root: string,
  report: (message: string) => void,
) {
  const warnings: Warning[] = [];
  let finished = false;
  return {
    warnings,
    get finished() {
      return finished;
    },
    read(line: string) {
      const event = JSON.parse(line) as CargoEvent;
      if (event.reason === "build-finished") finished = event.success === true;
      const diagnostic = event.message;
      if (
        event.reason !== "compiler-message" ||
        !diagnostic ||
        !event.manifest_path ||
        !event.target
      )
        return;
      const manifest = path.relative(root, event.manifest_path);
      if (path.isAbsolute(manifest) || manifest.startsWith("../")) return;
      if (diagnostic.level === "error")
        report(diagnostic.rendered ?? diagnostic.message);
      if (
        diagnostic.level !== "warning" ||
        diagnostic.code?.code !== "dead_code"
      )
        return;
      const spans = diagnostic.spans.filter((span) => span.is_primary);
      const files = spans.map((span) =>
        path.relative(
          root,
          path.resolve(root, path.dirname(manifest), span.file_name),
        ),
      );
      const message = diagnostic.message.replaceAll(root + "/", "");
      warnings.push({
        key: JSON.stringify([
          manifest,
          event.target.name,
          event.target.kind,
          diagnostic.code.code,
          message,
          spans.map((span, index) => [
            files[index],
            span.text.map((part) => part.text.trim()),
          ]),
        ]),
        message,
        location: spans.length
          ? `${files[0]}:${spans[0].line_start}`
          : manifest,
      });
    },
  };
}

export function newWarnings(
  baseline: Warning[],
  candidate: Warning[],
): Warning[] {
  const counts = new Map<string, number>();
  for (const warning of baseline)
    counts.set(warning.key, (counts.get(warning.key) ?? 0) + 1);
  return candidate.filter((warning) => {
    const count = counts.get(warning.key) ?? 0;
    if (!count) return true;
    counts.set(warning.key, count - 1);
    return false;
  });
}
