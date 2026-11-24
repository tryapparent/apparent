import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";

export type { Node as TreeNode } from "web-tree-sitter";

export async function preferenceParsers() {
  await Parser.init();
  const wasm = [
    ["rs", "@vscode/tree-sitter-wasm/wasm/tree-sitter-rust.wasm"],
    ["rsFallback", "tree-sitter-wasms/out/tree-sitter-rust.wasm"],
    ...["typescript", "tsx", "javascript"].map((language) => [
      language,
      `@repomix/tree-sitter-wasms/out/tree-sitter-${language}.wasm`,
    ]),
  ];
  return new Map(
    await Promise.all(
      wasm.map(async ([key, path]) => {
        const parser = new Parser();
        parser.setLanguage(
          await Language.load(fileURLToPath(import.meta.resolve(path))),
        );
        return [key, parser] as const;
      }),
    ),
  );
}
