import path from "node:path";
import { bendComments } from "../bend/source.ts";
import { fileURLToPath } from "node:url";
import { parentPort, Worker, workerData } from "node:worker_threads";
import { Parser, Language } from "web-tree-sitter";
import { Parser as YamlParser, parseAllDocuments } from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const languages: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  rs: "rust",
  swift: "swift",
  py: "python",
  css: "css",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  c: "c",
  h: "c",
  m: "objc",
  mm: "cpp",
  html: "html",
  htm: "html",
  json: "json",
  jsonc: "json",
};
const fallback = new Set(["toml", "objc", "html", "json"]);
const noncode = new Set([
  "md",
  "txt",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "icns",
  "ttf",
  "woff",
  "woff2",
  "mp4",
  "mp3",
  "wav",
  "pdf",
  "lock",
]);
const cache = new Map<string, Language>();
let initialized = false;
const swiftCommentTask = "apparent-swift-comments";
type EmbeddedHtml = { markup?: string };
const connectMigration =
  /^connect\/service\/migrations\/(?:baseline\/)?\d{4}\.sql$/;
let sqliteParser:
  | Promise<import("@willbooster/web-tree-sitter").Parser>
  | undefined;

async function createSqliteParser() {
  const { Parser, Language } = await import("@willbooster/web-tree-sitter");
  await Parser.init();
  const language = await Language.load(
    fileURLToPath(
      import.meta.resolve(
        "@willbooster/tree-sitter-sql/tree-sitter-sqlite.wasm",
      ),
    ),
  );
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

async function sqliteComments(file: string, text: string): Promise<string[]> {
  if (text.includes("\0"))
    throw new Error(`${file}: invalid NUL in SQLite syntax`);
  const parser = await (sqliteParser ??= createSqliteParser());
  const tree = parser.parse(text);
  try {
    if (!tree || tree.rootNode.hasError)
      throw new Error(
        `${file}: syntax parser cannot safely classify SQLite comments`,
      );
    return tree.rootNode
      .descendantsOfType("comment")
      .map((node) => node.text.replace(/\r$/, ""));
  } finally {
    tree?.delete();
  }
}

function swiftComments(file: string, text: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { task: swiftCommentTask, file, text },
    });
    let result: string[] | undefined;
    worker.once("message", (value: string[]) => {
      result = value;
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code === 0 && result) resolve(result);
      else
        reject(
          new Error(
            `${file}: isolated Swift comment parser exited without a result (status ${code})`,
          ),
        );
    });
  });
}

export async function comments(
  file: string,
  text: string,
  embeddedHtml?: EmbeddedHtml,
): Promise<string[]> {
  if (path.posix.basename(file) === ".gitattributes") {
    if (text.includes("\0"))
      throw new Error(`${file}: invalid NUL in attribute patterns`);
    return text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter((line) => /^[ \t\r]*#/.test(line));
  }
  if (path.posix.basename(file) === ".gitignore") {
    if (text.includes("\0"))
      throw new Error(`${file}: invalid NUL in ignore patterns`);
    return text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter((line) => line.startsWith("#"));
  }
  const ext = path.posix.extname(file).slice(1).toLowerCase();
  if (ext === "bend") return bendComments(file, text);
  if (connectMigration.test(file)) return sqliteComments(file, text);
  if (
    noncode.has(ext) ||
    ["LICENSE", "NOTICE"].includes(path.posix.basename(file))
  )
    return [];
  const firstLine = text.split("\n")[0];
  const shebang = /^#!.*\b(?:ba|da|z)?sh\b/.test(firstLine)
    ? "bash"
    : /^#!.*\bpython(?:[23](?:\.\d+)?)?\b/.test(firstLine)
      ? "python"
      : /^#!.*\bnode\b/.test(firstLine)
        ? "javascript"
        : undefined;
  const language = languages[ext] ?? shebang;
  if (!language)
    throw new Error(
      `${file}: unsupported comment syntax; add a pinned syntax parser before editing this file`,
    );
  if (language === "yaml") {
    if (parseAllDocuments(text).some((doc) => doc.errors.length))
      throw new Error(`${file}: invalid YAML syntax`);
    const result: string[] = [];
    function visit(value: any) {
      if (!value || typeof value !== "object") return;
      if (value.type === "comment") result.push(value.source);
      else
        for (const child of Object.values(value)) {
          if (Array.isArray(child)) child.forEach(visit);
          else visit(child);
        }
    }
    for (const token of new YamlParser().parse(text)) visit(token);
    return result;
  }
  if (language === "swift") return swiftComments(file, text);
  return treeSitterComments(file, text, language, embeddedHtml);
}

async function treeSitterComments(
  file: string,
  text: string,
  language: string,
  embeddedHtml?: EmbeddedHtml,
): Promise<string[]> {
  if (!initialized) {
    await Parser.init();
    initialized = true;
  }
  if (!cache.has(language))
    cache.set(
      language,
      await Language.load(
        language === "bash"
          ? path.join(
              here,
              "node_modules/tree-sitter-bash/tree-sitter-bash.wasm",
            )
          : language === "rust"
            ? path.join(
                here,
                "node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-rust.wasm",
              )
            : path.join(
                here,
                "node_modules",
                fallback.has(language)
                  ? "tree-sitter-wasms"
                  : "@repomix/tree-sitter-wasms",
                "out",
                `tree-sitter-${language}.wasm`,
              ),
      ),
    );
  const parser = new Parser();
  parser.setLanguage(cache.get(language)!);
  const tree = parser.parse(text);
  try {
    let objcModule = false;
    if (language === "objc" && tree?.rootNode.hasError) {
      const errors = tree.rootNode.children.filter((node) => node.hasError);
      const [statement] = errors;
      const call = statement?.firstNamedChild;
      const trailing = statement?.lastChild;
      objcModule =
        errors.length === 1 &&
        statement.type === "expression_statement" &&
        trailing?.type === ";" &&
        trailing.isMissing &&
        call?.type === "call_expression" &&
        !call.hasError &&
        /^NAPI_MODULE\([A-Za-z_]\w*,\s*[A-Za-z_]\w*\)$/.test(call.text);
    }
    if (!tree || (tree.rootNode.hasError && !objcModule))
      throw new Error(
        `${file}: syntax parser cannot safely classify comments; repair syntax or add supported grammar`,
      );
    const result: string[] = [];
    function visit(node: any) {
      if (/(?:^|_)comment$/.test(node.type)) {
        if (!(node.startIndex === 0 && node.text.startsWith("#!")))
          result.push(node.text.replace(/\r?\n$/, ""));
        return;
      }
      if (node.type === "raw_text" && node.text.trim()) {
        if (language !== "html" || !embeddedHtml)
          throw new Error(
            `${file}: embedded HTML code requires a dedicated parser; unsupported changed file`,
          );
        if (embeddedHtml.markup === undefined) {
          const parts: string[] = [];
          let offset = 0;
          for (const plainText of tree!.rootNode.descendantsOfType("text")) {
            parts.push(text.slice(offset, plainText.startIndex));
            offset = plainText.endIndex;
          }
          embeddedHtml.markup = parts.join("") + text.slice(offset);
        }
      }
      if (language === "swift" && node.type === "raw_string_literal")
        throw new Error(
          `${file}: syntax parser cannot safely classify Swift raw strings`,
        );
      for (const child of node.children) visit(child);
    }
    visit(tree.rootNode);
    return result;
  } finally {
    tree?.delete();
    parser.delete();
  }
}

if (parentPort && workerData?.task === swiftCommentTask) {
  parentPort.postMessage(
    await treeSitterComments(workerData.file, workerData.text, "swift"),
  );
}

export async function checkComments(
  cwd: string,
  head: string | undefined,
  tree: string,
): Promise<string[]> {
  const { git } = await import("./snapshot.ts");
  const before = new Map<string, string>();
  const after = new Map<string, string>();
  function entries(ref: string, output: Map<string, string>) {
    for (const row of git(["ls-tree", "-rz", ref], cwd)
      .split("\0")
      .filter(Boolean)) {
      const tab = row.indexOf("\t");
      output.set(row.slice(tab + 1), row.slice(0, tab));
    }
  }
  if (head) entries(head, before);
  entries(tree, after);
  const renames = new Map<string, string>();
  if (head) {
    const fields = git(
      ["diff", "--name-status", "-z", "--find-renames=50%", head, tree, "--"],
      cwd,
    ).split("\0");
    for (let i = 0; i < fields.length && fields[i]; ) {
      const status = fields[i++],
        old = fields[i++];
      if (status.startsWith("R")) {
        const next = fields[i++];
        if (!after.has(old) && !before.has(next)) renames.set(next, old);
      } else if (status.startsWith("C")) i++;
    }
  }
  const errors: string[] = [];
  for (const [file, meta] of after) {
    if (meta === before.get(file)) continue;
    const old = before.has(file) ? file : renames.get(file);
    try {
      if (!meta.startsWith("100"))
        throw new Error(
          `${file}: unsupported changed Git mode; comment rule requires regular files`,
        );
      const text = git(["show", `${tree}:${file}`], cwd);
      const candidateHtml: EmbeddedHtml = {};
      const baselineHtml: EmbeddedHtml = {};
      const candidate = await comments(file, text, candidateHtml);
      const baseline = old
        ? await comments(
            old,
            git(["show", `${head}:${old}`], cwd),
            baselineHtml,
          )
        : [];
      if (candidateHtml.markup !== baselineHtml.markup)
        throw new Error(
          `${file}: embedded HTML code requires a dedicated parser; only plain text changes are supported`,
        );
      const allowance = new Map<string, number>();
      for (const comment of baseline)
        allowance.set(comment, (allowance.get(comment) ?? 0) + 1);
      for (const comment of candidate) {
        const count = allowance.get(comment) ?? 0;
        if (count) allowance.set(comment, count - 1);
        else
          errors.push(
            `${file}: added/changed code comment ${JSON.stringify(comment.slice(0, 120))}`,
          );
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return errors;
}
