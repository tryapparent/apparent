import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tools = new URL(
  "../../../shared/enablement/dependency-policy/package.json",
  import.meta.url,
);
const require = createRequire(tools);
let language: Promise<{
  Parser: typeof import("web-tree-sitter").Parser;
  rust: import("web-tree-sitter").Language;
}>;

async function load() {
  try {
    const { Parser, Language } =
      require("web-tree-sitter") as typeof import("web-tree-sitter");
    await Parser.init();
    const grammar = path.join(
      path.dirname(fileURLToPath(tools)),
      "node_modules/@repomix/tree-sitter-wasms/out/tree-sitter-rust.wasm",
    );
    return { Parser, rust: await Language.load(grammar) };
  } catch (error) {
    throw Error(
      `Install the locked syntax tools with npm ci --ignore-scripts --prefix shared/enablement/dependency-policy: ${error}`,
    );
  }
}

export async function rustScopes(root: string) {
  const { Parser, rust } = await (language ??= load());
  const parser = new Parser();
  parser.setLanguage(rust);
  const cache = new Map<
    string,
    { bytes: Buffer; tree: import("web-tree-sitter").Tree }
  >();
  return {
    scope(file: string, byte: number): string[][] {
      if (path.isAbsolute(file) || file.startsWith("../")) return [];
      let parsed = cache.get(file);
      if (!parsed) {
        const absolute = path.join(root, file);
        const bytes = readFileSync(absolute);
        const tree = parser.parse(bytes.toString("utf8"));
        if (!tree) throw Error(`Could not parse warning source ${file}`);
        parsed = { bytes, tree };
        cache.set(file, parsed);
      }
      const index = parsed.bytes.subarray(0, byte).toString("utf8").length;
      const scopes: string[][] = [];
      for (
        let node = parsed.tree.rootNode.namedDescendantForIndex(index);
        node;
        node = node.parent
      ) {
        const name = node.childForFieldName("name");
        if (name) scopes.push([node.type, name.text]);
        if (node.type === "impl_item")
          scopes.push([
            node.type,
            node.childForFieldName("trait")?.text ?? "",
            node.childForFieldName("type")?.text ?? "",
          ]);
      }
      return scopes.reverse();
    },
    dispose() {
      for (const { tree } of cache.values()) tree.delete();
      parser.delete();
    },
  };
}
